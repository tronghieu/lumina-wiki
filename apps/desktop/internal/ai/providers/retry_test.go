package providers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHTTPStatusErrorsHaveStableClassificationAndRetryDelay(t *testing.T) {
	now := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		status int
		code   string
		retry  bool
	}{
		{400, "invalid_request", false}, {401, "invalid_credential", false},
		{403, "permission_denied", false}, {404, "endpoint_or_model_not_found", false},
		{408, "timeout", false}, {409, "conflict", false}, {413, "request_too_large", false},
		{429, "rate_limited", true}, {451, "provider_status", false},
		{500, "provider_unavailable", true}, {502, "provider_unavailable", true},
		{503, "provider_unavailable", true}, {504, "provider_unavailable", true},
		{599, "provider_unavailable", true},
	}
	for _, tc := range cases {
		err := statusErrorAt(tc.status, "2", now)
		var safe *SafeError
		if !errors.As(err, &safe) || safe.Code != tc.code || safe.retryable != tc.retry {
			t.Fatalf("status %d: err=%#v", tc.status, safe)
		}
		if tc.retry && safe.retryAfter != 2*time.Second {
			t.Fatalf("status %d delay=%v", tc.status, safe.retryAfter)
		}
		if !tc.retry && safe.retryAfter != 0 {
			t.Fatalf("non-retryable status %d retained delay=%v", tc.status, safe.retryAfter)
		}
	}
	for header, want := range map[string]time.Duration{
		"31":                  30 * time.Second,
		"9223372036854775807": 30 * time.Second,
		now.Add(4 * time.Second).Format(http.TimeFormat): 4 * time.Second,
		"-1":                                0,
		"malicious secret https://10.0.0.1": 0,
	} {
		if got := retryAfterDelay(header, now); got != want {
			t.Fatalf("header %q: got %v want %v", header, got, want)
		}
	}
}

func TestHTTPStatusRetryBoundaryIsLimitedToFiveHundreds(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
		retry  bool
	}{
		{499, "provider_status", false},
		{500, "provider_unavailable", true},
		{599, "provider_unavailable", true},
		{600, "provider_error", false},
		{999, "provider_error", false},
	} {
		err := statusErrorAt(tc.status, "0", time.Now())
		var safe *SafeError
		if !errors.As(err, &safe) || safe.Code != tc.code || safe.retryable != tc.retry {
			t.Fatalf("status=%d error=%#v", tc.status, safe)
		}
		attempts := 0
		base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{
			func(context.Context, StreamSink) error { attempts++; return err },
			func(context.Context, StreamSink) error { attempts++; return nil },
		}}
		provider := NewRetryingProvider(base, RetryOptions{Sleep: func(context.Context, time.Duration) error { return nil }})
		_, _ = collect(provider, validRequest())
		want := 1
		if tc.retry {
			want = 2
		}
		if attempts != want {
			t.Fatalf("status=%d attempts=%d want=%d", tc.status, attempts, want)
		}
	}
}

func TestRetryAfterHugeNumericValueClampsWithoutOverflow(t *testing.T) {
	huge := strings.Repeat("9", 1000)
	if got := retryAfterDelay(huge, time.Now()); got != 30*time.Second {
		t.Fatalf("delay=%v", got)
	}
	for _, malformed := range []string{"12x", "+12", "1.5"} {
		if delay, present := parseRetryAfter(malformed, time.Now()); delay != 0 || present {
			t.Fatalf("value=%q delay=%v present=%v", malformed, delay, present)
		}
	}
}

func TestFactoryInjectedClockControlsHTTPDateRetryAfter(t *testing.T) {
	now := time.Date(2026, 7, 12, 8, 0, 0, 0, time.UTC)
	calls := 0
	client := captureClient(t, func(*http.Request) *http.Response {
		calls++
		if calls == 1 {
			return &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": {now.Add(6 * time.Second).Format(http.TimeFormat)}}, Body: io.NopCloser(strings.NewReader("discard"))}
		}
		return sseResponse(200, "data: {\"type\":\"response.completed\",\"sequence_number\":0,\"response\":{\"usage\":{\"input_tokens\":0,\"output_tokens\":0,\"total_tokens\":0}}}\n\n")
	})
	var delay time.Duration
	clockCalls := 0
	provider, err := NewProviderWithRetryOptions(validProfile("openai"), client, &fakeCredentialResolver{secret: []byte("x")}, RetryOptions{
		Clock: func() time.Time { clockCalls++; return now },
		Sleep: func(_ context.Context, got time.Duration) error { delay = got; return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = collect(provider, validRequest()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || clockCalls != 1 || delay != 6*time.Second {
		t.Fatalf("calls=%d clockCalls=%d delay=%v", calls, clockCalls, delay)
	}
}

type trackingBody struct {
	reader  io.Reader
	closed  bool
	drained bool
}

func (b *trackingBody) Read(p []byte) (int, error) {
	n, err := b.reader.Read(p)
	if errors.Is(err, io.EOF) {
		b.drained = true
	}
	return n, err
}
func (b *trackingBody) Close() error { b.closed = true; return nil }

func TestHTTPErrorDiscardsAndClosesBodyWithoutLeakingResponseDetails(t *testing.T) {
	body := &trackingBody{reader: strings.NewReader("secret prompt https://10.0.0.1/private")}
	response := &http.Response{
		StatusCode: 429,
		Status:     "429 secret status",
		Header: http.Header{
			"Content-Type": {"application/json"},
			"Retry-After":  {"secret https://private.invalid"},
		},
		Body: body,
	}
	client := captureClient(t, func(*http.Request) *http.Response { return response })
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://api.example.com/v1/responses", strings.NewReader("prompt"))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer credential")
	err = streamResponse(context.Background(), client, request,
		StreamSinkFunc(func(context.Context, StreamEvent) error { return nil }),
		func(SSEEvent) error { return nil }, false, time.Now)
	if err == nil || !body.closed || !body.drained {
		t.Fatalf("err=%v closed=%v drained=%v", err, body.closed, body.drained)
	}
	for _, unsafe := range []string{"secret", "prompt", "10.0.0.1", "private.invalid", "credential"} {
		if strings.Contains(err.Error(), unsafe) {
			t.Fatalf("leaked %q in %q", unsafe, err)
		}
	}
}

type scriptedProvider struct {
	mu       sync.Mutex
	attempts []func(context.Context, StreamSink) error
	calls    int
}

func (p *scriptedProvider) Stream(ctx context.Context, _ ChatRequest, sink StreamSink) error {
	p.mu.Lock()
	i := p.calls
	p.calls++
	p.mu.Unlock()
	return p.attempts[i](ctx, sink)
}

func retryError(code string) error {
	return newClassifiedSafeError(code, "The provider request failed.", nil, true, 0)
}

func TestRetryingProviderRetriesOnceBeforeOutputAndStreamsSecondAttempt(t *testing.T) {
	base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{
		func(context.Context, StreamSink) error { return retryError("provider_unavailable") },
		func(ctx context.Context, sink StreamSink) error {
			return sink.OnEvent(ctx, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: "ok"}})
		},
	}}
	var waits []time.Duration
	var observations []RetryObservation
	p := NewRetryingProvider(base, RetryOptions{Timeout: time.Second, Backoff: 7 * time.Millisecond,
		Sleep:    func(_ context.Context, delay time.Duration) error { waits = append(waits, delay); return nil },
		Observer: func(observation RetryObservation) { observations = append(observations, observation) }})
	events, err := collect(p, validRequest())
	if err != nil || base.calls != 2 || len(events) != 1 || events[0].Delta.Text != "ok" || len(waits) != 1 || waits[0] != 7*time.Millisecond || len(observations) != 1 || observations[0] != (RetryObservation{Attempt: 1, Code: "provider_unavailable"}) {
		t.Fatalf("calls=%d events=%#v waits=%v observations=%v err=%v", base.calls, events, waits, observations, err)
	}
}

func TestRetryingProviderRetriesEachApprovedFailureClassExactlyOnce(t *testing.T) {
	now := time.Now()
	errorsToRetry := []error{
		statusErrorAt(429, "0", now), statusErrorAt(500, "0", now),
		statusErrorAt(502, "0", now), statusErrorAt(503, "0", now), statusErrorAt(504, "0", now),
		NewSafeError("provider_request", "Request failed.", nil),
		NewSafeError("endpoint_connect", "Connect failed.", nil),
		NewSafeError("transport_unavailable", "Transport unavailable.", nil),
	}
	for _, first := range errorsToRetry {
		first := first
		t.Run(first.Error(), func(t *testing.T) {
			base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{
				func(context.Context, StreamSink) error { return first },
				func(context.Context, StreamSink) error { return nil },
			}}
			p := NewRetryingProvider(base, RetryOptions{Sleep: func(context.Context, time.Duration) error { return nil }})
			if _, err := collect(p, validRequest()); err != nil || base.calls != 2 {
				t.Fatalf("err=%v calls=%d", err, base.calls)
			}
		})
	}
}

func TestRetryingProviderNeverRetriesUnsafeOrPostOutputFailures(t *testing.T) {
	for _, tc := range []struct {
		name string
		run  func(context.Context, StreamSink) error
	}{
		{"invalid request", func(context.Context, StreamSink) error { return NewSafeError("invalid_request", "Invalid.", nil) }},
		{"invalid credential", func(context.Context, StreamSink) error { return statusError(401) }},
		{"permission", func(context.Context, StreamSink) error { return statusError(403) }},
		{"not found", func(context.Context, StreamSink) error { return statusError(404) }},
		{"too large", func(context.Context, StreamSink) error { return statusError(413) }},
		{"content type", func(context.Context, StreamSink) error {
			return NewSafeError("invalid_content_type", "Invalid response.", nil)
		}},
		{"malformed", func(context.Context, StreamSink) error { return malformed() }},
		{"incomplete", func(context.Context, StreamSink) error { return incomplete() }},
		{"canceled", func(context.Context, StreamSink) error { return context.Canceled }},
		{"deadline", func(context.Context, StreamSink) error { return context.DeadlineExceeded }},
		{"delta then error", func(ctx context.Context, sink StreamSink) error {
			if err := sink.OnEvent(ctx, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: "partial"}}); err != nil {
				return err
			}
			return retryError("provider_unavailable")
		}},
		{"usage then error", func(ctx context.Context, sink StreamSink) error {
			if err := sink.OnEvent(ctx, StreamEvent{Kind: EventUsage, Usage: &Usage{}}); err != nil {
				return err
			}
			return retryError("provider_unavailable")
		}},
		{"refusal then error", func(ctx context.Context, sink StreamSink) error {
			if err := sink.OnEvent(ctx, StreamEvent{Kind: EventRefusal, Refusal: &Refusal{Message: "no"}}); err != nil {
				return err
			}
			return retryError("provider_unavailable")
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{tc.run}}
			p := NewRetryingProvider(base, RetryOptions{Sleep: func(context.Context, time.Duration) error { t.Fatal("slept"); return nil }})
			_, _ = collect(p, validRequest())
			if base.calls != 1 {
				t.Fatalf("calls=%d", base.calls)
			}
		})
	}
}

func TestRetryingProviderReturnsSinkErrorEvenWhenSinkCancelsContext(t *testing.T) {
	sinkErr := errors.New("sink failed")
	base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{
		func(ctx context.Context, sink StreamSink) error {
			return sink.OnEvent(ctx, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: "x"}})
		},
	}}
	ctx, cancel := context.WithCancel(context.Background())
	p := NewRetryingProvider(base, RetryOptions{})
	err := p.Stream(ctx, validRequest(), StreamSinkFunc(func(context.Context, StreamEvent) error {
		cancel()
		return sinkErr
	}))
	if !errors.Is(err, sinkErr) || base.calls != 1 {
		t.Fatalf("err=%v calls=%d", err, base.calls)
	}
}

func TestRetryingProviderReturnsSecondFailureAndHonorsRetryAfter(t *testing.T) {
	second := NewSafeError("invalid_credential", "Credential rejected.", nil)
	base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{
		func(context.Context, StreamSink) error {
			return newClassifiedSafeError("rate_limited", "Busy.", nil, true, 3*time.Second)
		},
		func(context.Context, StreamSink) error { return second },
	}}
	var delay time.Duration
	p := NewRetryingProvider(base, RetryOptions{Sleep: func(_ context.Context, d time.Duration) error { delay = d; return nil }})
	_, err := collect(p, validRequest())
	if err != second || base.calls != 2 || delay != 3*time.Second {
		t.Fatalf("err=%v calls=%d delay=%v", err, base.calls, delay)
	}
}

func TestRetryingProviderHonorsExplicitZeroRetryAfter(t *testing.T) {
	first := statusErrorAt(http.StatusTooManyRequests, "0", time.Now())
	base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{
		func(context.Context, StreamSink) error { return first },
		func(context.Context, StreamSink) error { return nil },
	}}
	got := time.Second
	p := NewRetryingProvider(base, RetryOptions{Backoff: time.Second, Sleep: func(_ context.Context, delay time.Duration) error {
		got = delay
		return nil
	}})
	_, err := collect(p, validRequest())
	if err != nil || got != 0 {
		t.Fatalf("err=%v delay=%v", err, got)
	}
}

func TestRetryingProviderCancellationDuringBackoffStopsSecondAttempt(t *testing.T) {
	base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{
		func(context.Context, StreamSink) error { return retryError("provider_unavailable") },
	}}
	ctx, cancel := context.WithCancel(context.Background())
	p := NewRetryingProvider(base, RetryOptions{Sleep: func(ctx context.Context, _ time.Duration) error {
		cancel()
		<-ctx.Done()
		return ctx.Err()
	}})
	_, err := collectWithContext(ctx, p)
	if err != context.Canceled || base.calls != 1 {
		t.Fatalf("err=%v calls=%d", err, base.calls)
	}
}

func TestRetryingProviderOverallTimeoutIncludesBackoff(t *testing.T) {
	base := &scriptedProvider{attempts: []func(context.Context, StreamSink) error{
		func(context.Context, StreamSink) error { return retryError("provider_unavailable") },
	}}
	p := NewRetryingProvider(base, RetryOptions{Timeout: time.Millisecond, Sleep: func(ctx context.Context, _ time.Duration) error {
		<-ctx.Done()
		return ctx.Err()
	}})
	_, err := collect(p, validRequest())
	if err != context.DeadlineExceeded || base.calls != 1 {
		t.Fatalf("err=%v calls=%d", err, base.calls)
	}
}

func TestFactoryWrapsConcreteProviderExactlyOnce(t *testing.T) {
	p, err := NewProvider(validProfile("openai"), SafeClient{}, &fakeCredentialResolver{secret: []byte("x")})
	if err != nil {
		t.Fatal(err)
	}
	retrying, ok := p.(*retryingProvider)
	if !ok {
		t.Fatalf("factory returned %T", p)
	}
	if _, nested := retrying.provider.(*retryingProvider); nested {
		t.Fatal("provider double wrapped")
	}
	if NewRetryingProvider(p, RetryOptions{}) != p {
		t.Fatal("decorator double wrapped provider")
	}
}

type isolatedConcurrentProvider struct {
	mu    sync.Mutex
	calls map[string]int
}

func (p *isolatedConcurrentProvider) Stream(ctx context.Context, request ChatRequest, sink StreamSink) error {
	key := request.Turns[0].Content
	p.mu.Lock()
	p.calls[key]++
	call := p.calls[key]
	p.mu.Unlock()
	if call == 1 {
		return retryError("provider_unavailable")
	}
	return sink.OnEvent(ctx, StreamEvent{Kind: EventDelta, Delta: &Delta{Text: key}})
}

func TestRetryingProviderConcurrentStreamsAreIsolated(t *testing.T) {
	base := &isolatedConcurrentProvider{calls: make(map[string]int)}
	p := NewRetryingProvider(base, RetryOptions{Sleep: func(context.Context, time.Duration) error { return nil }})
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			request := validRequest()
			request.Turns[0].Content = string(rune('a' + i))
			var events []StreamEvent
			err := p.Stream(context.Background(), request, StreamSinkFunc(func(_ context.Context, event StreamEvent) error {
				events = append(events, event)
				return nil
			}))
			if err != nil || len(events) != 1 || events[0].Delta.Text != request.Turns[0].Content {
				t.Errorf("request %q events=%#v err=%v", request.Turns[0].Content, events, err)
			}
		}()
	}
	wg.Wait()
	base.mu.Lock()
	defer base.mu.Unlock()
	for key, calls := range base.calls {
		if calls != 2 {
			t.Errorf("%q calls=%d", key, calls)
		}
	}
}

func collectWithContext(ctx context.Context, provider ChatProvider) ([]StreamEvent, error) {
	var events []StreamEvent
	err := provider.Stream(ctx, validRequest(), StreamSinkFunc(func(_ context.Context, event StreamEvent) error {
		events = append(events, event)
		return nil
	}))
	return events, err
}
