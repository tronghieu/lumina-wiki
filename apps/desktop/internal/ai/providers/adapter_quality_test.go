package providers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func anthropicUsageStream(input, output int) string {
	return "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":" + itoa(input) + "}}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":" + itoa(output) + "}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
}

func TestAnthropicUsageTotalAndBounds(t *testing.T) {
	for name, tc := range rangeUsageCases() {
		t.Run(name, func(t *testing.T) {
			input, output, ok := tc.input, tc.output, tc.ok
			p, _ := NewProvider(validProfile(settings.ProviderAnthropic), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, anthropicUsageStream(input, output)) }), &fakeCredentialResolver{secret: []byte("x")})
			events, err := collect(p, validRequest())
			if !ok {
				if err == nil || safeCode(err) != "malformed_stream" {
					t.Fatalf("err=%v", err)
				}
				return
			}
			if err != nil || len(events) != 1 || events[0].Usage.TotalTokens != input+output {
				t.Fatalf("events=%#v err=%v", events, err)
			}
		})
	}
}

func rangeUsageCases() map[string]struct {
	input, output int
	ok            bool
} {
	return map[string]struct {
		input, output int
		ok            bool
	}{"normal": {2, 3, true}, "boundary": {MaxUsageTokens, 0, true}, "input overflow": {MaxUsageTokens + 1, 0, false}, "output overflow": {0, MaxUsageTokens + 1, false}, "total overflow": {MaxUsageTokens, 1, false}}
}

func itoa(value int) string { return strconv.Itoa(value) }

type timeoutBody struct{ closed chan struct{} }

func (b *timeoutBody) Read([]byte) (int, error) { <-b.closed; return 0, errors.New("closed") }
func (b *timeoutBody) Close() error {
	select {
	case <-b.closed:
	default:
		close(b.closed)
	}
	return nil
}

func TestProfileTimeoutCoversBodyAndEarlierCallerDeadline(t *testing.T) {
	for _, tc := range []struct {
		name                string
		profileMS, callerMS int
		maxElapsed          time.Duration
	}{{"profile", 100, 0, 500 * time.Millisecond}, {"caller", 1000, 20, 100 * time.Millisecond}} {
		t.Run(tc.name, func(t *testing.T) {
			profileMS, callerMS := tc.profileMS, tc.callerMS
			body := &timeoutBody{closed: make(chan struct{})}
			profile := validProfile(settings.ProviderOpenAI)
			profile.TimeoutMS = profileMS
			client := captureClient(t, func(*http.Request) *http.Response {
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: body}
			})
			p, err := NewProvider(profile, client, &fakeCredentialResolver{secret: []byte("x")})
			if err != nil {
				t.Fatal(err)
			}
			var ctx context.Context = context.Background()
			cancel := func() {}
			if callerMS > 0 {
				ctx, cancel = context.WithTimeout(ctx, time.Duration(callerMS)*time.Millisecond)
			}
			defer cancel()
			start := time.Now()
			err = p.Stream(ctx, validRequest(), StreamSinkFunc(func(context.Context, StreamEvent) error { return nil }))
			if err != context.DeadlineExceeded || time.Since(start) > tc.maxElapsed {
				t.Fatalf("err=%v elapsed=%v", err, time.Since(start))
			}
			select {
			case <-body.closed:
			default:
				t.Fatal("body not closed")
			}
		})
	}
}

type blockingResolver struct{ called bool }

func (r *blockingResolver) Get(ctx context.Context, _ string) ([]byte, error) {
	r.called = true
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestProfileTimeoutCoversCredentialResolver(t *testing.T) {
	profile := validProfile(settings.ProviderOpenAI)
	profile.TimeoutMS = 100
	resolver := &blockingResolver{}
	p, err := NewProvider(profile, captureClient(t, func(*http.Request) *http.Response { t.Fatal("HTTP called"); return nil }), resolver)
	if err != nil {
		t.Fatal(err)
	}
	err = p.Stream(context.Background(), validRequest(), StreamSinkFunc(func(context.Context, StreamEvent) error { return nil }))
	if !resolver.called || err != context.DeadlineExceeded {
		t.Fatalf("called=%v err=%v", resolver.called, err)
	}
}

func TestFactoryCredentialResolverOptionality(t *testing.T) {
	profile := validProfile(settings.ProviderOllama)
	profile.CredentialRef = ""
	client := captureClient(t, func(r *http.Request) *http.Response {
		if r.Header.Get("Authorization") != "" {
			t.Fatal("authorization set")
		}
		return sseResponse(200, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	})
	p, err := NewProvider(profile, client, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = collect(p, validRequest()); err != nil {
		t.Fatal(err)
	}
	profile.CredentialRef = "configured"
	if _, err = NewProvider(profile, client, nil); err == nil {
		t.Fatal("configured credential accepted nil resolver")
	}
	for _, kind := range []settings.ProviderKind{settings.ProviderOpenAI, settings.ProviderAnthropic, settings.ProviderGemini} {
		profile = validProfile(kind)
		profile.CredentialRef = ""
		if _, err = NewProvider(profile, client, &fakeCredentialResolver{}); err == nil {
			t.Fatalf("%s accepted empty credential", kind)
		}
	}
}

var _ io.ReadCloser = (*timeoutBody)(nil)
