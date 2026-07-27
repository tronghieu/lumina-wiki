package providers

import (
	"net/http"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func TestGeminiBlockedFinishReasonsMapExplicitlyToRefusal(t *testing.T) {
	blocked := []string{"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION"}
	for _, reason := range blocked {
		t.Run(reason, func(t *testing.T) {
			stream := "data: {\"candidates\":[{\"finishReason\":\"" + reason + "\"}]}\n\n"
			p, _ := NewProvider(validProfile(settings.ProviderGemini), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
			events, err := collect(p, validRequest())
			if err != nil || len(events) != 1 || events[0].Kind != EventRefusal || events[0].Refusal == nil {
				t.Fatalf("events=%#v err=%v", events, err)
			}
		})
	}
}

func TestGeminiPromptBlockReasonsUseSameExplicitMapping(t *testing.T) {
	for _, reason := range []string{"IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION"} {
		t.Run(reason, func(t *testing.T) {
			stream := "data: {\"promptFeedback\":{\"blockReason\":\"" + reason + "\"}}\n\n"
			p, _ := NewProvider(validProfile(settings.ProviderGemini), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
			events, err := collect(p, validRequest())
			if err != nil || len(events) != 1 || events[0].Kind != EventRefusal {
				t.Fatalf("events=%#v err=%v", events, err)
			}
		})
	}
}

func TestGeminiFinishReasonClassificationDoesNotBroadMap(t *testing.T) {
	for _, reason := range []string{"STOP", "MAX_TOKENS"} {
		t.Run(reason, func(t *testing.T) {
			stream := "data: {\"candidates\":[{\"finishReason\":\"" + reason + "\"}],\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":1,\"totalTokenCount\":2}}\n\n"
			p, _ := NewProvider(validProfile(settings.ProviderGemini), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
			events, err := collect(p, validRequest())
			if err != nil || len(events) != 1 || events[0].Kind != EventUsage {
				t.Fatalf("events=%#v err=%v", events, err)
			}
		})
	}
	for _, reason := range []string{"IMAGE_OTHER", "NO_IMAGE", "MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"} {
		t.Run(reason, func(t *testing.T) {
			stream := "data: {\"candidates\":[{\"finishReason\":\"" + reason + "\"}],\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":1,\"totalTokenCount\":2}}\n\n"
			p, _ := NewProvider(validProfile(settings.ProviderGemini), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
			events, err := collect(p, validRequest())
			if err == nil || safeCode(err) != "incomplete_response" || len(events) != 0 {
				t.Fatalf("events=%#v err=%v", events, err)
			}
		})
	}
}

func TestGeminiUnknownPromptBlockReasonIsNotRefusal(t *testing.T) {
	stream := "data: {\"promptFeedback\":{\"blockReason\":\"IMAGE_OTHER\"}}\n\n"
	p, _ := NewProvider(validProfile(settings.ProviderGemini), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	events, err := collect(p, validRequest())
	if err == nil || safeCode(err) != "incomplete_response" || len(events) != 0 {
		t.Fatalf("events=%#v err=%v", events, err)
	}
}
