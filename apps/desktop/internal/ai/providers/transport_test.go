package providers

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type recordingDialer struct {
	addresses []string
	fail      int
}

func (d *recordingDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	d.addresses = append(d.addresses, network+" "+address)
	if len(d.addresses) <= d.fail {
		return nil, errors.New("dial failed")
	}
	a, b := net.Pipe()
	go func() { <-ctx.Done(); a.Close() }()
	return b, nil
}

func mustApprove(t *testing.T, raw string, r Resolver) ApprovedEndpoint {
	t.Helper()
	a, err := (EndpointPolicy{Resolver: r}).Approve(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestPinnedTransportIgnoresDNSAndProxyPreservesTLSIdentity(t *testing.T) {
	a := mustApprove(t, "https://api.example.com:8443/v1", resolverFor("api.example.com", "93.184.216.34", "93.184.216.35"))
	d := &recordingDialer{fail: 1}
	os.Setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
	t.Cleanup(func() { os.Unsetenv("HTTPS_PROXY") })
	tr, err := NewPinnedTransport(a, TransportOptions{DialContext: d.DialContext})
	if err != nil {
		t.Fatal(err)
	}
	if tr.Proxy != nil || tr.TLSClientConfig.ServerName != "api.example.com" || tr.TLSClientConfig.MinVersion != tls.VersionTLS12 || tr.TLSClientConfig.InsecureSkipVerify || tr.TLSHandshakeTimeout <= 0 {
		t.Fatal("unsafe transport configuration")
	}
	c, err := tr.DialContext(context.Background(), "tcp", "api.example.com:8443")
	if err != nil {
		t.Fatal(err)
	}
	c.Close()
	want := []string{"tcp 93.184.216.34:8443", "tcp 93.184.216.35:8443"}
	if strings.Join(d.addresses, "|") != strings.Join(want, "|") {
		t.Fatalf("dials %#v", d.addresses)
	}
}

func TestPinnedTransportRejectsUnexpectedDialAndHonorsContext(t *testing.T) {
	a := mustApprove(t, "https://api.example.com/v1", resolverFor("api.example.com", "93.184.216.34"))
	d := &recordingDialer{}
	tr, _ := NewPinnedTransport(a, TransportOptions{DialContext: d.DialContext})
	if _, err := tr.DialContext(context.Background(), "udp", "api.example.com:443"); err == nil {
		t.Fatal("allowed udp")
	}
	if _, err := tr.DialContext(context.Background(), "tcp", "other.example:443"); err == nil {
		t.Fatal("allowed other authority")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := tr.DialContext(ctx, "tcp", "api.example.com:443"); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func response(status int, location string) *http.Response {
	h := make(http.Header)
	if location != "" {
		h.Set("Location", location)
	}
	return &http.Response{StatusCode: status, Header: h, Body: io.NopCloser(strings.NewReader("ok"))}
}

func TestSafeClientRedirectPolicyAndCredentialForwarding(t *testing.T) {
	r := &fakeResolver{answers: map[string][]net.IPAddr{
		"api.example.com": {{IP: net.ParseIP("93.184.216.34").To4()}, {IP: net.ParseIP("93.184.216.35").To4()}},
		"other.example":   {{IP: net.ParseIP("1.1.1.1").To4()}},
	}}
	var seen []*http.Request
	c := SafeClient{Policy: EndpointPolicy{Resolver: r}, MaxRedirects: 3, NewRoundTripper: func(a ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(req *http.Request) (*http.Response, error) {
			seen = append(seen, req.Clone(req.Context()))
			switch len(seen) {
			case 1:
				return response(302, "/next"), nil
			case 2:
				return response(302, "https://other.example/final"), nil
			default:
				return response(200, ""), nil
			}
		})
	}}
	req, _ := http.NewRequest("GET", "https://api.example.com/start", nil)
	req.Header.Set("Authorization", "Bearer top-secret")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(seen) != 3 || seen[0].Header.Get("Authorization") == "" || seen[1].Header.Get("Authorization") == "" || seen[2].Header.Get("Authorization") != "" {
		t.Fatalf("credential forwarding wrong")
	}
	if r.calls != 3 {
		t.Fatalf("each hop must re-resolve, got %d", r.calls)
	}
}

func TestSafeClientRejectsDowngradeAndRedirectCap(t *testing.T) {
	r := resolverFor("api.example.com", "93.184.216.34")
	client := SafeClient{Policy: EndpointPolicy{Resolver: r}, MaxRedirects: 1, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(*http.Request) (*http.Response, error) { return response(302, "http://127.0.0.1/x"), nil })
	}}
	req, _ := http.NewRequest("GET", "https://api.example.com", nil)
	if _, err := client.Do(req); err == nil {
		t.Fatal("allowed downgrade")
	}
	client.NewRoundTripper = func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(*http.Request) (*http.Response, error) { return response(302, "/again"), nil })
	}
	if _, err := client.Do(req); err == nil {
		t.Fatal("allowed redirect overflow")
	}
}

func TestSafeClientUsesNormalizedOriginForCredentials(t *testing.T) {
	r := resolverFor("api.example.com", "93.184.216.34")
	var seen []string
	client := SafeClient{Policy: EndpointPolicy{Resolver: r}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(req *http.Request) (*http.Response, error) {
			seen = append(seen, req.Header.Get("Authorization"))
			if len(seen) == 1 {
				return response(302, "https://API.EXAMPLE.COM:443/next"), nil
			}
			return response(200, ""), nil
		})
	}}
	req, _ := http.NewRequest("GET", "https://api.example.com/start", nil)
	req.Header.Set("Authorization", "Bearer secret")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(seen) != 2 || seen[1] == "" {
		t.Fatal("normalized same-origin redirect lost credentials")
	}
}

func TestTransportOptionsHaveBoundedDefaults(t *testing.T) {
	o := (TransportOptions{}).withDefaults()
	for _, d := range []time.Duration{o.DialTimeout, o.KeepAlive, o.IdleConnTimeout, o.ResponseHeaderTimeout} {
		if d <= 0 {
			t.Fatal("missing timeout")
		}
	}
	if o.MaxResponseBytes <= 0 {
		t.Fatal("missing response cap")
	}
}

func TestSafeClientCapsResponseBody(t *testing.T) {
	client := SafeClient{
		Policy:  EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")},
		Options: TransportOptions{MaxResponseBytes: 2},
		NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
			return roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("abcde"))}, nil
			})
		},
	}
	req, _ := http.NewRequest("GET", "https://api.example.com", nil)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	got, err := io.ReadAll(resp.Body)
	var safe *SafeError
	if !errors.As(err, &safe) || safe.Code != "response_too_large" {
		t.Fatalf("expected overflow error, got %v", err)
	}
	if string(got) != "ab" {
		t.Fatalf("body cap failed: %q", got)
	}
}

func TestSafeClientExactResponseLimit(t *testing.T) {
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, Options: TransportOptions{MaxResponseBytes: 2}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(*http.Request) (*http.Response, error) { return response(200, ""), nil })
	}}
	req, _ := http.NewRequest("GET", "https://api.example.com", nil)
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil || string(got) != "ok" {
		t.Fatalf("got %q %v", got, err)
	}
}

func TestCrossOriginStripsAllSensitiveHeadersAndKeepsOrdinary(t *testing.T) {
	r := &fakeResolver{answers: map[string][]net.IPAddr{
		"api.example.com": {{IP: net.ParseIP("93.184.216.34").To4()}},
		"other.example":   {{IP: net.ParseIP("1.1.1.1").To4()}},
	}}
	var final http.Header
	c := SafeClient{Policy: EndpointPolicy{Resolver: r}, CredentialHeaders: []string{"X-Custom-Cred"}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if req.URL.Hostname() == "api.example.com" {
				return response(302, "https://other.example/final"), nil
			}
			final = req.Header.Clone()
			return response(200, ""), nil
		})
	}}
	req, _ := http.NewRequest("GET", "https://api.example.com", nil)
	for _, k := range []string{"Authorization", "Proxy-Authorization", "Cookie", "X-API-Key", "Api-Key", "X-Goog-Api-Key", "Access-Token", "X-Signature", "X-Credential", "X-Custom-Cred"} {
		req.Header.Set(k, "secret")
	}
	req.Header.Set("X-Trace", "keep")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	for k := range req.Header {
		if k != "X-Trace" && final.Get(k) != "" {
			t.Errorf("leaked %s", k)
		}
	}
	if final.Get("X-Trace") != "keep" {
		t.Fatal("ordinary header stripped")
	}
}

type cleanupRT struct {
	roundTripFunc
	closes int
}

func (r *cleanupRT) CloseIdleConnections() { r.closes++ }
func TestSafeClientClearsAttackerHostAndCleansTransport(t *testing.T) {
	var seenHost, urlHost string
	var transports []*cleanupRT
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		rt := &cleanupRT{}
		rt.roundTripFunc = func(req *http.Request) (*http.Response, error) {
			seenHost = req.Host
			urlHost = req.URL.Host
			return response(200, ""), nil
		}
		transports = append(transports, rt)
		return rt
	}}
	req, _ := http.NewRequest("GET", "https://API.EXAMPLE.COM:443/v1", nil)
	req.Host = "attacker.invalid"
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if seenHost != "" || urlHost != "api.example.com" {
		t.Fatalf("host=%q url=%q", seenHost, urlHost)
	}
	resp.Body.Close()
	if transports[0].closes != 1 {
		t.Fatalf("cleanup=%d", transports[0].closes)
	}
}

type changingResolver struct{ calls int }

func (r *changingResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	r.calls++
	if r.calls == 1 {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34").To4()}}, nil
	}
	return []net.IPAddr{{IP: net.ParseIP("10.0.0.1").To4()}}, nil
}

type failingBody struct{}

func (failingBody) Read([]byte) (int, error) { return 0, errors.New("read failed") }
func (failingBody) Close() error             { return nil }
func TestBoundedBodyCleansUpOnReadError(t *testing.T) {
	cleanups := 0
	b := newBoundedBody(failingBody{}, 10, func() { cleanups++ })
	if _, err := b.Read(make([]byte, 1)); err == nil {
		t.Fatal("expected read error")
	}
	if cleanups != 1 {
		t.Fatalf("cleanups=%d", cleanups)
	}
}

type sensitiveBody struct{ readErr, closeErr error }

func (b *sensitiveBody) Read([]byte) (int, error) { return 0, b.readErr }
func (b *sensitiveBody) Close() error             { return b.closeErr }
func TestBoundedBodySanitizesReadAndCloseErrors(t *testing.T) {
	raw := errors.New("secret https://private.example at 10.0.0.1")
	cleanups := 0
	b := newBoundedBody(&sensitiveBody{readErr: raw, closeErr: raw}, 10, func() { cleanups++ })
	_, readErr := b.Read(make([]byte, 1))
	var safe *SafeError
	if !errors.As(readErr, &safe) || safe.Code != "response_read" || errors.Is(readErr, raw) {
		t.Fatalf("unsafe read error: %v", readErr)
	}
	closeErr := b.Close()
	if !errors.As(closeErr, &safe) || safe.Code != "response_close" || errors.Is(closeErr, raw) {
		t.Fatalf("unsafe close error: %v", closeErr)
	}
	if cleanups != 1 {
		t.Fatalf("cleanups=%d", cleanups)
	}
	for _, err := range []error{readErr, closeErr} {
		for _, bad := range []string{"secret", "private.example", "10.0.0.1"} {
			if strings.Contains(err.Error(), bad) {
				t.Fatalf("leak %q", bad)
			}
		}
	}
}

func TestBoundedBodyPreservesEOF(t *testing.T) {
	b := newBoundedBody(io.NopCloser(strings.NewReader("")), 1, func() {})
	_, err := b.Read(make([]byte, 1))
	if !errors.Is(err, io.EOF) {
		t.Fatalf("got %v", err)
	}
}

func TestBoundedBodyZeroLengthReadDoesNotProbe(t *testing.T) {
	body := &sensitiveBody{readErr: errors.New("must not read")}
	b := newBoundedBody(body, 0, func() {})
	if n, err := b.Read(nil); n != 0 || err != nil {
		t.Fatalf("got %d %v", n, err)
	}
}

func TestRedirectMethodAndBodySemantics(t *testing.T) {
	tests := []struct {
		name         string
		status       int
		method, want string
		replay       bool
	}{
		{"post302", 302, "POST", "GET", false}, {"post303", 303, "POST", "GET", false}, {"head303", 303, "HEAD", "HEAD", false}, {"post307", 307, "POST", "POST", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			var secondBody string
			c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
				return roundTripFunc(func(req *http.Request) (*http.Response, error) {
					calls++
					if calls == 1 {
						return response(tc.status, "/next"), nil
					}
					if req.Body != nil {
						raw, _ := io.ReadAll(req.Body)
						secondBody = string(raw)
					}
					if req.Method != tc.want {
						t.Fatalf("method=%s", req.Method)
					}
					return response(200, ""), nil
				})
			}}
			req, _ := http.NewRequest(tc.method, "https://api.example.com/start", strings.NewReader("payload"))
			resp, err := c.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if tc.replay && secondBody != "payload" {
				t.Fatalf("body=%q", secondBody)
			}
			if !tc.replay && secondBody != "" {
				t.Fatalf("resent body %q", secondBody)
			}
		})
	}
}

func TestRedirect307RejectsNonReplayableBody(t *testing.T) {
	calls := 0
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(*http.Request) (*http.Response, error) { calls++; return response(307, "/next"), nil })
	}}
	req, _ := http.NewRequest("POST", "https://api.example.com", io.NopCloser(strings.NewReader("x")))
	_, err := c.Do(req)
	var safe *SafeError
	if !errors.As(err, &safe) || safe.Code != "redirect_body_not_replayable" || calls != 1 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}

func TestRedirect301DropsGETBody(t *testing.T) {
	calls := 0
	var bodies []string
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(req *http.Request) (*http.Response, error) {
			calls++
			var raw []byte
			if req.Body != nil {
				raw, _ = io.ReadAll(req.Body)
			}
			bodies = append(bodies, string(raw))
			if calls == 1 {
				return response(301, "/next"), nil
			}
			return response(200, ""), nil
		})
	}}
	req, _ := http.NewRequest("GET", "https://api.example.com", strings.NewReader("payload"))
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if fmt.Sprint(bodies) != "[payload ]" {
		t.Fatalf("bodies=%v", bodies)
	}
}

func TestRedirect307ReplaysFreshBodyAcrossMultipleHops(t *testing.T) {
	calls := 0
	var bodies []string
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(req *http.Request) (*http.Response, error) {
			calls++
			raw, _ := io.ReadAll(req.Body)
			bodies = append(bodies, string(raw))
			if calls < 3 {
				return response(307, "/next"), nil
			}
			return response(200, ""), nil
		})
	}}
	req, _ := http.NewRequest("POST", "https://api.example.com", strings.NewReader("payload"))
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if fmt.Sprint(bodies) != "[payload payload payload]" {
		t.Fatalf("bodies=%v", bodies)
	}
}

type countedReplayBody struct{ closes *atomic.Int32 }

func (b *countedReplayBody) Read([]byte) (int, error) { return 0, io.EOF }
func (b *countedReplayBody) Close() error             { b.closes.Add(1); return nil }

func TestRedirectDelaysReplayUntilEndpointApproved(t *testing.T) {
	resolver := &changingResolver{}
	created := atomic.Int32{}
	closed := atomic.Int32{}
	calls := 0
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolver}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(*http.Request) (*http.Response, error) { calls++; return response(307, "/next"), nil })
	}}
	req, _ := http.NewRequest("POST", "https://api.example.com", strings.NewReader("x"))
	req.GetBody = func() (io.ReadCloser, error) { created.Add(1); return &countedReplayBody{closes: &closed}, nil }
	_, err := c.Do(req)
	if err == nil {
		t.Fatal("expected endpoint rejection")
	}
	if created.Load() != 0 || closed.Load() != 0 || calls != 1 {
		t.Fatalf("created=%d closed=%d calls=%d", created.Load(), closed.Load(), calls)
	}
}

func TestRedirectDelaysReplayUntilTransportExists(t *testing.T) {
	created := atomic.Int32{}
	closed := atomic.Int32{}
	calls := 0
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		calls++
		if calls == 1 {
			return roundTripFunc(func(*http.Request) (*http.Response, error) { return response(307, "/next"), nil })
		}
		return nil
	}}
	req, _ := http.NewRequest("POST", "https://api.example.com", strings.NewReader("x"))
	req.GetBody = func() (io.ReadCloser, error) { created.Add(1); return &countedReplayBody{closes: &closed}, nil }
	_, err := c.Do(req)
	var safe *SafeError
	if !errors.As(err, &safe) || safe.Code != "transport_unavailable" {
		t.Fatalf("got %v", err)
	}
	if created.Load() != 0 || closed.Load() != 0 {
		t.Fatalf("created=%d closed=%d", created.Load(), closed.Load())
	}
}

type unsafeCountingBody struct {
	closes int
	closed chan struct{}
}

func (b *unsafeCountingBody) Read([]byte) (int, error) { return 0, io.EOF }
func (b *unsafeCountingBody) Close() error {
	b.closes++
	select {
	case <-b.closed:
	default:
		close(b.closed)
	}
	return nil
}

func TestRoundTripperOwnsBodyAfterHandoff(t *testing.T) {
	body := &unsafeCountingBody{closed: make(chan struct{})}
	rtDone := make(chan struct{})
	rtErr := errors.New("rt failed")
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(req *http.Request) (*http.Response, error) {
			go func() { defer close(rtDone); time.Sleep(time.Millisecond); _ = req.Body.Close() }()
			return nil, rtErr
		})
	}}
	req, _ := http.NewRequest("POST", "https://api.example.com", body)
	_, err := c.Do(req)
	if err == nil {
		t.Fatal("expected error")
	}
	select {
	case <-rtDone:
	case <-time.After(time.Second):
		t.Fatal("RT did not close body")
	}
	if body.closes != 1 {
		t.Fatalf("closes=%d", body.closes)
	}
}

func TestPreflightErrorsCloseInitialBodyOnce(t *testing.T) {
	for _, tc := range []struct {
		name   string
		client SafeClient
		url    string
	}{{"endpoint", SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "10.0.0.1")}}, "https://api.example.com"}, {"transport", SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper { return nil }}, "https://api.example.com"}} {
		t.Run(tc.name, func(t *testing.T) {
			body := &unsafeCountingBody{closed: make(chan struct{})}
			req, _ := http.NewRequest("POST", tc.url, body)
			if _, err := tc.client.Do(req); err == nil {
				t.Fatal("expected error")
			}
			if body.closes != 1 {
				t.Fatalf("closes=%d", body.closes)
			}
		})
	}
}

func TestInvalidRequestClosesOwnedBodyOnce(t *testing.T) {
	c := SafeClient{}
	var safe *SafeError
	if _, err := c.Do(nil); !errors.As(err, &safe) || safe.Code != "invalid_request" {
		t.Fatalf("nil request: %v", err)
	}
	body := &unsafeCountingBody{closed: make(chan struct{})}
	req := &http.Request{Body: body}
	_, err := c.Do(req)
	if !errors.As(err, &safe) || safe.Code != "invalid_request" {
		t.Fatalf("nil URL: %v", err)
	}
	if body.closes != 1 {
		t.Fatalf("closes=%d", body.closes)
	}
}

func TestReplayMaterializationErrorClosesReturnedBody(t *testing.T) {
	created := &unsafeCountingBody{closed: make(chan struct{})}
	calls := 0
	c := SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(*http.Request) (*http.Response, error) { calls++; return response(307, "/next"), nil })
	}}
	req, _ := http.NewRequest("POST", "https://api.example.com", strings.NewReader("x"))
	req.GetBody = func() (io.ReadCloser, error) { return created, errors.New("materialize failed") }
	_, err := c.Do(req)
	if err == nil {
		t.Fatal("expected error")
	}
	if created.closes != 1 || calls != 1 {
		t.Fatalf("closes=%d calls=%d", created.closes, calls)
	}
}

func TestPinnedDialUsesOneOverallTimeout(t *testing.T) {
	ips := make([]string, 16)
	for i := range ips {
		ips[i] = fmt.Sprintf("8.8.8.%d", i+1)
	}
	a := mustApprove(t, "https://api.example.com", resolverFor("api.example.com", ips...))
	start := time.Now()
	tr, _ := NewPinnedTransport(a, TransportOptions{DialTimeout: 20 * time.Millisecond, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) { <-ctx.Done(); return nil, ctx.Err() }})
	_, err := tr.DialContext(context.Background(), "tcp", "api.example.com:443")
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 100*time.Millisecond {
		t.Fatalf("err=%v elapsed=%v", err, time.Since(start))
	}
}
func TestRedirectRebindingStopsBeforeRoundTrip(t *testing.T) {
	r := &changingResolver{}
	roundTrips := 0
	c := SafeClient{Policy: EndpointPolicy{Resolver: r}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(*http.Request) (*http.Response, error) { roundTrips++; return response(302, "/next"), nil })
	}}
	req, _ := http.NewRequest("GET", "https://api.example.com/start", nil)
	if _, err := c.Do(req); err == nil {
		t.Fatal("expected rebinding rejection")
	}
	if roundTrips != 1 {
		t.Fatalf("round trips=%d", roundTrips)
	}
}
