package providers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type fakeCredentialResolver struct {
	secret []byte
	err    error
	refs   []string
}

type rejectingCredentialResolver struct{ called bool }

func (r *rejectingCredentialResolver) Get(context.Context, string) ([]byte, error) {
	r.called = true
	return nil, errors.New("must not resolve")
}

func (r *fakeCredentialResolver) Get(ctx context.Context, ref string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.refs = append(r.refs, ref)
	if r.err != nil {
		return nil, r.err
	}
	return append([]byte(nil), r.secret...), nil
}

func validProfile(kind settings.ProviderKind) settings.Profile {
	return settings.Profile{SchemaVersion: 1, ID: "chat", Role: settings.RoleChat, Kind: kind,
		Label: "Chat", Model: "model-1", BaseURL: "https://api.example.com/v1", CredentialRef: "cred:one",
		TimeoutMS: 1000, MaxInputChars: 1000, MaxHistoryChars: 1000, MaxEvidenceChars: 1000, MaxOutputTokens: 100}
}

func captureClient(t *testing.T, check func(*http.Request) *http.Response) SafeClient {
	t.Helper()
	return SafeClient{Policy: EndpointPolicy{Resolver: resolverFor("api.example.com", "93.184.216.34")}, NewRoundTripper: func(ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(r *http.Request) (*http.Response, error) { return check(r), nil })
	}}
}

func sseResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"Text/Event-Stream; charset=utf-8"}}, Body: io.NopCloser(oneByteReader{strings.NewReader(body)})}
}

func validRequest() ProviderRequest {
	return ProviderRequest{Model: "model-1", System: "be concise", Turns: []ChatMessage{{Role: "user", Content: "hello"}}, MaxOutputTokens: 12}
}

func collect(provider ChatProvider, request ProviderRequest) ([]StreamEvent, error) {
	var events []StreamEvent
	err := provider.Stream(context.Background(), request, StreamSinkFunc(func(_ context.Context, event StreamEvent) error {
		events = append(events, event)
		return nil
	}))
	return events, err
}

func TestProviderRequestValidation(t *testing.T) {
	for name, request := range map[string]ProviderRequest{
		"missing model":   {Turns: []ChatMessage{{Role: "user", Content: "x"}}},
		"empty turns":     {Model: "m"},
		"bad role":        {Model: "m", Turns: []ChatMessage{{Role: "tool", Content: "x"}}},
		"empty content":   {Model: "m", Turns: []ChatMessage{{Role: "user"}}},
		"final assistant": {Model: "m", Turns: []ChatMessage{{Role: "user", Content: "x"}, {Role: "assistant", Content: "y"}}},
		"invalid utf8":    {Model: "m", Turns: []ChatMessage{{Role: "user", Content: string([]byte{0xff})}}},
		"negative tokens": {Model: "m", Turns: []ChatMessage{{Role: "user", Content: "x"}}, MaxOutputTokens: -1},
	} {
		t.Run(name, func(t *testing.T) {
			if err := request.Validate(); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
	if err := validRequest().Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestFactoryRejectsInvalidProfileRoleAndExactKind(t *testing.T) {
	resolver := &fakeCredentialResolver{secret: []byte("secret")}
	profile := validProfile(settings.ProviderOpenAI)
	profile.Role = settings.RoleEmbedding
	if _, err := NewProvider(profile, SafeClient{}, resolver); err == nil {
		t.Fatal("accepted embedding role")
	}
	profile = validProfile(settings.ProviderKind("OpenAI"))
	if _, err := NewProvider(profile, SafeClient{}, resolver); err == nil {
		t.Fatal("accepted inexact kind")
	}
}

func TestOpenAIRequestAndStream(t *testing.T) {
	resolver := &fakeCredentialResolver{secret: []byte("top-secret")}
	client := captureClient(t, func(r *http.Request) *http.Response {
		if r.Method != http.MethodPost || r.URL.EscapedPath() != "/v1/responses" || r.URL.RawQuery != "" {
			t.Fatalf("request target %s %s", r.Method, r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer top-secret" || r.Header.Get("Accept") != "text/event-stream" || r.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("headers %#v", r.Header)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "model-1" || body["stream"] != true || body["store"] != false || body["instructions"] != "be concise" || body["max_output_tokens"] != float64(12) || body["tools"] != nil {
			t.Fatalf("body %#v", body)
		}
		return sseResponse(200, "data: {\"type\":\"unknown\"}\n\ndata: {\"type\":\"response.output_text.delta\",\"sequence_number\":1,\"delta\":\"hi\"}\n\ndata: {\"type\":\"response.refusal.delta\",\"sequence_number\":2,\"delta\":\"no\"}\n\ndata: {\"type\":\"response.completed\",\"sequence_number\":3,\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":3,\"total_tokens\":5}}}\n\n")
	})
	provider, err := NewProvider(validProfile(settings.ProviderOpenAI), client, resolver)
	if err != nil {
		t.Fatal(err)
	}
	events, err := collect(provider, validRequest())
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[0].Delta.Text != "hi" || events[1].Refusal.Message != "no" || *events[2].Usage != (Usage{InputTokens: 2, OutputTokens: 3, TotalTokens: 5}) {
		t.Fatalf("events %#v", events)
	}
	if len(resolver.refs) != 1 || resolver.refs[0] != "cred:one" {
		t.Fatalf("refs %#v", resolver.refs)
	}
}

func TestAdapterSanitizesStatusAndKnownMalformedEvent(t *testing.T) {
	secret := "do-not-leak"
	for name, response := range map[string]*http.Response{
		"status":    {StatusCode: 401, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(secret))},
		"malformed": sseResponse(200, "data: {\"type\":\"response.output_text.delta\",\"delta\":7}\n\n"),
	} {
		t.Run(name, func(t *testing.T) {
			p, err := NewProvider(validProfile(settings.ProviderOpenAI), captureClient(t, func(*http.Request) *http.Response { return response }), &fakeCredentialResolver{secret: []byte(secret)})
			if err != nil {
				t.Fatal(err)
			}
			_, err = collect(p, validRequest())
			var safe *SafeError
			if !errors.As(err, &safe) || strings.Contains(err.Error(), secret) {
				t.Fatalf("unsafe error %v", err)
			}
		})
	}
}

func TestOpenAICompletedRequiresResponseUsageObject(t *testing.T) {
	p, _ := NewProvider(validProfile(settings.ProviderOpenAI), captureClient(t, func(*http.Request) *http.Response {
		return sseResponse(200, "data: {\"type\":\"response.completed\"}\n\n")
	}), &fakeCredentialResolver{secret: []byte("x")})
	if _, err := collect(p, validRequest()); err == nil {
		t.Fatal("accepted missing response usage")
	}
}

func TestAdapterRejectsModelDriftAndProfileBudgetOverflow(t *testing.T) {
	profile := validProfile(settings.ProviderOpenAI)
	p, err := NewProvider(profile, captureClient(t, func(*http.Request) *http.Response { t.Fatal("must not send"); return nil }), &fakeCredentialResolver{secret: []byte("x")})
	if err != nil {
		t.Fatal(err)
	}
	request := validRequest()
	request.Model = "other-model"
	if _, err := collect(p, request); err == nil {
		t.Fatal("accepted model drift")
	}
	request = validRequest()
	request.MaxOutputTokens = profile.MaxOutputTokens + 1
	if _, err := collect(p, request); err == nil {
		t.Fatal("accepted profile budget overflow")
	}
}

func TestAdapterPreservesEscapedBasePathWhileAppending(t *testing.T) {
	profile := validProfile(settings.ProviderOpenAI)
	profile.BaseURL = "https://api.example.com/tenant%2Fone/v1"
	p, err := NewProvider(profile, captureClient(t, func(r *http.Request) *http.Response {
		if r.URL.EscapedPath() != "/tenant%2Fone/v1/responses" {
			t.Fatalf("escaped path changed: %s", r.URL.EscapedPath())
		}
		return sseResponse(200, "data: {\"type\":\"response.completed\",\"sequence_number\":0,\"response\":{\"usage\":{\"input_tokens\":0,\"output_tokens\":0,\"total_tokens\":0}}}\n\n")
	}), &fakeCredentialResolver{secret: []byte("x")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := collect(p, validRequest()); err != nil {
		t.Fatal(err)
	}
}
