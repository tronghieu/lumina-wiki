package providers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func TestProviderWireMessagesUseOnlyLowercaseKeys(t *testing.T) {
	for _, kind := range []settings.ProviderKind{settings.ProviderOpenAI, settings.ProviderAnthropic, settings.ProviderOpenAICompatible} {
		t.Run(string(kind), func(t *testing.T) {
			client := captureClient(t, func(r *http.Request) *http.Response {
				var root map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&root); err != nil {
					t.Fatal(err)
				}
				key := "messages"
				if kind == settings.ProviderOpenAI {
					key = "input"
				}
				var messages []map[string]json.RawMessage
				if err := json.Unmarshal(root[key], &messages); err != nil || len(messages) == 0 {
					t.Fatalf("messages=%v err=%v body=%s", messages, err, root[key])
				}
				for _, message := range messages {
					if message["role"] == nil || message["content"] == nil || message["Role"] != nil || message["Content"] != nil {
						t.Fatalf("wire keys %#v", message)
					}
				}
				switch kind {
				case settings.ProviderOpenAI:
					return sseResponse(200, "data: {\"type\":\"response.completed\",\"sequence_number\":0,\"response\":{\"usage\":{\"input_tokens\":0,\"output_tokens\":0,\"total_tokens\":0}}}\n\n")
				case settings.ProviderAnthropic:
					return sseResponse(200, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":0}}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":0}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
				default:
					return sseResponse(200, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
				}
			})
			p, err := NewProvider(validProfile(kind), client, &fakeCredentialResolver{secret: []byte("x")})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := collect(p, validRequest()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProfileBudgetsRejectBeforeCredentialOrHTTP(t *testing.T) {
	profile := validProfile(settings.ProviderOpenAI)
	profile.MaxInputChars, profile.MaxHistoryChars, profile.MaxEvidenceChars = 3, 4, 2
	for name, mutate := range map[string]func(*ProviderRequest){
		"latest input": func(r *ProviderRequest) { r.Turns = []ChatMessage{{Role: "user", Content: "four"}} },
		"history": func(r *ProviderRequest) {
			r.Turns = []ChatMessage{{Role: "user", Content: "12345"}, {Role: "user", Content: "ok"}}
		},
		"system": func(r *ProviderRequest) { r.System = "abc" },
		"turn count": func(r *ProviderRequest) {
			r.Turns = make([]ChatMessage, MaxProviderTurns+1)
			for i := range r.Turns {
				r.Turns[i] = ChatMessage{Role: "user", Content: "x"}
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			resolver := &rejectingCredentialResolver{}
			client := captureClient(t, func(*http.Request) *http.Response { t.Fatal("HTTP called"); return nil })
			p, err := NewProvider(profile, client, resolver)
			if err != nil {
				t.Fatal(err)
			}
			r := validRequest()
			mutate(&r)
			if _, err := collect(p, r); err == nil {
				t.Fatal("accepted over-budget request")
			}
			if resolver.called {
				t.Fatal("credential resolver called")
			}
		})
	}
}

func TestProviderRequestRejectsAggregateAmplification(t *testing.T) {
	turn := strings.Repeat("x", MaxProviderTurnChars)
	r := ProviderRequest{Model: "m", Turns: []ChatMessage{{Role: "user", Content: turn}, {Role: "user", Content: turn}, {Role: "user", Content: turn}, {Role: "user", Content: turn}, {Role: "user", Content: turn}, {Role: "user", Content: turn}, {Role: "user", Content: turn}, {Role: "user", Content: turn}, {Role: "user", Content: turn}}}
	if err := r.Validate(); err == nil {
		t.Fatal("accepted aggregate amplification")
	}
}

func TestCompatibleToolOnlyDoneIsEmptyCompletion(t *testing.T) {
	stream := "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"id\":\"x\"}],\"function_call\":{\"name\":\"f\"}},\"finish_reason\":\"tool_calls\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}\n\ndata: [DONE]\n\n"
	p, _ := NewProvider(validProfile(settings.ProviderOpenAICompatible), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	events, err := collect(p, validRequest())
	if err == nil || safeCode(err) != "empty_completion" {
		t.Fatalf("events=%#v err=%v", events, err)
	}
}

func TestKnownEventsRequireNumericPresence(t *testing.T) {
	cases := []struct {
		name   string
		kind   settings.ProviderKind
		stream string
	}{
		{"openai usage field", settings.ProviderOpenAI, "data: {\"type\":\"response.completed\",\"sequence_number\":0,\"response\":{\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n"},
		{"openai sequence", settings.ProviderOpenAI, "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":0,\"output_tokens\":0,\"total_tokens\":0}}}\n\n"},
		{"anthropic input", settings.ProviderAnthropic, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{}}}\n\n"},
		{"anthropic output", settings.ProviderAnthropic, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":0}}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{}}\n\n"},
		{"anthropic index", settings.ProviderAnthropic, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":0}}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"text\"}}\n\n"},
		{"gemini usage", settings.ProviderGemini, "data: {\"candidates\":[{\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":0,\"candidatesTokenCount\":0}}\n\n"},
		{"compatible usage", settings.ProviderOpenAICompatible, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":0}}\n\n"},
		{"openai usage sum", settings.ProviderOpenAI, "data: {\"type\":\"response.completed\",\"sequence_number\":0,\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1,\"total_tokens\":3}}}\n\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, _ := NewProvider(validProfile(tc.kind), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, tc.stream) }), &fakeCredentialResolver{secret: []byte("x")})
			if _, err := collect(p, validRequest()); err == nil || safeCode(err) != "malformed_stream" {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestGeminiThinkingUsagePreservesProviderTotal(t *testing.T) {
	stream := "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"answer\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":10,\"candidatesTokenCount\":5,\"thoughtsTokenCount\":7,\"cachedContentTokenCount\":3,\"totalTokenCount\":22}}\n\n"
	p, _ := NewProvider(validProfile(settings.ProviderGemini), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	events, err := collect(p, validRequest())
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[1].Usage == nil || *events[1].Usage != (Usage{InputTokens: 10, OutputTokens: 5, TotalTokens: 22}) {
		t.Fatalf("events=%#v", events)
	}
}

func TestGeminiUsageRejectsMissingNegativeAndSmallTotals(t *testing.T) {
	for name, usage := range map[string]string{
		"missing required":     `{"promptTokenCount":10,"candidatesTokenCount":5}`,
		"negative optional":    `{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":-1,"totalTokenCount":15}`,
		"small required total": `{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":14}`,
		"small additive total": `{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":7,"toolUsePromptTokenCount":2,"totalTokenCount":23}`,
	} {
		t.Run(name, func(t *testing.T) {
			stream := "data: {\"candidates\":[{\"finishReason\":\"STOP\"}],\"usageMetadata\":" + usage + "}\n\n"
			p, _ := NewProvider(validProfile(settings.ProviderGemini), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
			if _, err := collect(p, validRequest()); err == nil || safeCode(err) != "malformed_stream" {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestAnthropicContentDeltaRequiresNonemptyType(t *testing.T) {
	stream := "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":0}}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{}}\n\nevent: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":0}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
	p, _ := NewProvider(validProfile(settings.ProviderAnthropic), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	if _, err := collect(p, validRequest()); err == nil || safeCode(err) != "malformed_stream" {
		t.Fatalf("err=%v", err)
	}
}

func safeCode(err error) string {
	var safe *SafeError
	if errors.As(err, &safe) {
		return safe.Code
	}
	return ""
}
