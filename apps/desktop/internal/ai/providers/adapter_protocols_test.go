package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func TestAnthropicRequestAndLifecycle(t *testing.T) {
	client := captureClient(t, func(r *http.Request) *http.Response {
		if r.URL.EscapedPath() != "/v1/messages" || r.Header.Get("X-Api-Key") != "anthropic-secret" || r.Header.Get("Anthropic-Version") != "2023-06-01" || r.Header.Get("Anthropic-Beta") != "" {
			t.Fatalf("request %#v %s", r.Header, r.URL)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "model-1" || body["max_tokens"] != float64(12) || body["stream"] != true || body["system"] != "be concise" || body["tools"] != nil {
			t.Fatalf("body %#v", body)
		}
		return sseResponse(200, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":4}}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\nevent: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
	})
	p, err := NewProvider(validProfile(settings.ProviderAnthropic), client, &fakeCredentialResolver{secret: []byte("anthropic-secret")})
	if err != nil {
		t.Fatal(err)
	}
	events, err := collect(p, validRequest())
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Delta.Text != "hello" || *events[1].Usage != (Usage{InputTokens: 4, OutputTokens: 2, TotalTokens: 6}) {
		t.Fatalf("events %#v", events)
	}
}

func TestAnthropicRejectsOutOfOrderAndDuplicateTerminal(t *testing.T) {
	for name, stream := range map[string]string{
		"out of order": "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"x\"}}\n\n",
		"duplicate":    "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1}}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
	} {
		t.Run(name, func(t *testing.T) {
			p, _ := NewProvider(validProfile(settings.ProviderAnthropic), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
			if _, err := collect(p, validRequest()); err == nil {
				t.Fatal("expected lifecycle error")
			}
		})
	}
}

func TestAnthropicIgnoresUnknownEventWithoutApplyingKnownPayload(t *testing.T) {
	stream := "event: future_event\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":999}}}\n\nevent: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1}}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":0}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
	p, _ := NewProvider(validProfile(settings.ProviderAnthropic), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	events, err := collect(p, validRequest())
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Usage.InputTokens != 1 {
		t.Fatalf("events %#v", events)
	}
}

func TestGeminiRequestControlledQueryAndStream(t *testing.T) {
	client := captureClient(t, func(r *http.Request) *http.Response {
		if r.URL.EscapedPath() != "/v1/models/model-1:streamGenerateContent" || r.URL.RawQuery != "alt=sse" || r.Header.Get("X-Goog-Api-Key") != "gemini-secret" {
			t.Fatalf("request %s %#v", r.URL, r.Header)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["system_instruction"] == nil || body["contents"] == nil || body["generationConfig"] == nil || body["tools"] != nil || body["safetySettings"] != nil {
			t.Fatalf("body %#v", body)
		}
		return sseResponse(200, "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"gem\"},{\"functionCall\":{\"name\":\"ignored\"}}]}}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":0,\"totalTokenCount\":3}}\n\ndata: {\"candidates\":[{\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":2,\"totalTokenCount\":5}}\n\n")
	})
	p, err := NewProvider(validProfile(settings.ProviderGemini), client, &fakeCredentialResolver{secret: []byte("gemini-secret")})
	if err != nil {
		t.Fatal(err)
	}
	events, err := collect(p, validRequest())
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Delta.Text != "gem" || *events[1].Usage != (Usage{InputTokens: 3, OutputTokens: 2, TotalTokens: 5}) {
		t.Fatalf("events %#v", events)
	}
}

func TestGeminiRejectsEmptyKnownResponse(t *testing.T) {
	stream := "data: {}\n\ndata: {\"candidates\":[{\"finishReason\":\"STOP\"}]}\n\n"
	p, _ := NewProvider(validProfile(settings.ProviderGemini), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	if _, err := collect(p, validRequest()); err == nil {
		t.Fatal("accepted empty response")
	}
}

func TestSafeClientControlledQueryIsNotPubliclyGeneral(t *testing.T) {
	client := captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, "") })
	for _, raw := range []string{"https://api.example.com/v1?alt=json", "https://api.example.com/v1?alt=sse&key=x", "https://api.example.com/v1?ordinary=x"} {
		r, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, raw, nil)
		if _, err := client.Do(r); err == nil {
			t.Fatalf("allowed %s", raw)
		}
	}
}

func TestCompatibleRequestAndUsageOnlyFinalChunk(t *testing.T) {
	for _, kind := range []settings.ProviderKind{settings.ProviderOpenAICompatible, settings.ProviderOllama} {
		t.Run(string(kind), func(t *testing.T) {
			profile := validProfile(kind)
			if kind == settings.ProviderOllama {
				profile.CredentialRef = "cred:optional"
			}
			client := captureClient(t, func(r *http.Request) *http.Response {
				if r.URL.EscapedPath() != "/v1/chat/completions" {
					t.Fatalf("url %s", r.URL)
				}
				if kind == settings.ProviderOllama && r.Header.Get("Authorization") != "" {
					t.Fatal("unexpected authorization")
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				options := body["stream_options"].(map[string]any)
				if options["include_usage"] != true || body["max_tokens"] != float64(12) || body["tools"] != nil {
					t.Fatalf("body %#v", body)
				}
				return sseResponse(200, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\",\"tool_calls\":[{}]},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\ndata: [DONE]\n\n")
			})
			secret := []byte("compatible-secret")
			if kind == settings.ProviderOllama {
				secret = nil
			}
			p, err := NewProvider(profile, client, &fakeCredentialResolver{secret: secret})
			if err != nil {
				t.Fatal(err)
			}
			events, err := collect(p, validRequest())
			if err != nil {
				t.Fatal(err)
			}
			if len(events) != 2 || events[0].Delta.Text != "ok" || *events[1].Usage != (Usage{InputTokens: 5, OutputTokens: 2, TotalTokens: 7}) {
				t.Fatalf("events %#v", events)
			}
		})
	}
}

func TestCompatibleRequiresDoneAndRejectsToolOnlyOutput(t *testing.T) {
	stream := "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"id\":\"x\"}]},\"finish_reason\":\"stop\"}]}\n\n"
	p, _ := NewProvider(validProfile(settings.ProviderOpenAICompatible), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	events, err := collect(p, validRequest())
	if err == nil || len(events) != 0 {
		t.Fatalf("events=%#v err=%v", events, err)
	}
}

func TestCompatibleRejectsEmptyChunk(t *testing.T) {
	stream := "data: {}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
	p, _ := NewProvider(validProfile(settings.ProviderOpenAICompatible), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	if _, err := collect(p, validRequest()); err == nil {
		t.Fatal("accepted empty chunk")
	}
}

func TestCompatibleWithoutConfiguredCredentialSkipsResolution(t *testing.T) {
	profile := validProfile(settings.ProviderOllama)
	profile.CredentialRef = ""
	resolver := &rejectingCredentialResolver{}
	p, err := NewProvider(profile, captureClient(t, func(r *http.Request) *http.Response {
		if r.Header.Get("Authorization") != "" {
			t.Fatal("unexpected authorization")
		}
		return sseResponse(200, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}), resolver)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := collect(p, validRequest()); err != nil {
		t.Fatal(err)
	}
	if resolver.called {
		t.Fatal("resolved an unconfigured credential")
	}
}
