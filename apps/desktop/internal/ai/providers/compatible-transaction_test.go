package providers

import (
	"context"
	"net/http"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func compatibleForStream(t *testing.T, stream string) ChatProvider {
	t.Helper()
	p, err := NewProvider(validProfile(settings.ProviderOpenAICompatible), captureClient(t, func(*http.Request) *http.Response { return sseResponse(200, stream) }), &fakeCredentialResolver{secret: []byte("x")})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestCompatibleAllowsOneUsageOnlyChunkAfterFinish(t *testing.T) {
	stream := "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}\n\ndata: [DONE]\n\n"
	events, err := collect(compatibleForStream(t, stream), validRequest())
	if err != nil || len(events) != 2 || events[0].Kind != EventDelta || events[1].Kind != EventUsage {
		t.Fatalf("events=%#v err=%v", events, err)
	}
}

func TestCompatibleRejectsInvalidFinishUsageOrdering(t *testing.T) {
	finish := `{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}`
	usage := `{"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`
	for name, chunks := range map[string][]string{"output after finish": {finish, `{"choices":[{"delta":{"content":"late"},"finish_reason":null}]}`}, "duplicate usage": {finish, usage, usage}, "usage before finish": {usage, finish}, "duplicate finish": {`{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"},{"delta":{},"finish_reason":"length"}]}`}, "chunk after usage": {finish, usage, `{"choices":[]}`}} {
		t.Run(name, func(t *testing.T) {
			stream := ""
			for _, chunk := range chunks {
				stream += "data: " + chunk + "\n\n"
			}
			stream += "data: [DONE]\n\n"
			if _, err := collect(compatibleForStream(t, stream), validRequest()); err == nil || safeCode(err) != "malformed_stream" {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestCompatibleAllowsUsageInSameFinishChunk(t *testing.T) {
	stream := "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1,\"total_tokens\":3}}\n\ndata: [DONE]\n\n"
	events, err := collect(compatibleForStream(t, stream), validRequest())
	if err != nil || len(events) != 2 || events[1].Kind != EventUsage {
		t.Fatalf("events=%#v err=%v", events, err)
	}
}

func TestCompatibleMalformedChunkEmitsNothingTransactionally(t *testing.T) {
	for name, chunk := range map[string]string{"content empty finish": `{"choices":[{"delta":{"content":"leak"},"finish_reason":""}]}`, "content usage before finish": `{"choices":[{"delta":{"content":"leak"},"finish_reason":null}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`, "refusal conflicting finish": `{"choices":[{"delta":{"refusal":"leak"},"finish_reason":"stop"},{"delta":{},"finish_reason":"length"}]}`} {
		t.Run(name, func(t *testing.T) {
			events, err := collect(compatibleForStream(t, "data: "+chunk+"\n\n"), validRequest())
			if err == nil || safeCode(err) != "malformed_stream" || len(events) != 0 {
				t.Fatalf("events=%#v err=%v", events, err)
			}
		})
	}
}

func TestCompatibleMalformedChunkDoesNotMutateState(t *testing.T) {
	var events []StreamEvent
	state := compatibleState{ctx: context.Background(), sink: StreamSinkFunc(func(_ context.Context, event StreamEvent) error { events = append(events, event); return nil })}
	err := state.accept(SSEEvent{Data: `{"choices":[{"delta":{"content":"leak"},"finish_reason":""}]}`})
	if err == nil || len(events) != 0 || state.finished || state.output || state.usageSeen {
		t.Fatalf("state=%#v events=%#v err=%v", state, events, err)
	}
	err = state.accept(SSEEvent{Data: `{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}`})
	if err != nil || len(events) != 1 || !state.finished || !state.output {
		t.Fatalf("state=%#v events=%#v err=%v", state, events, err)
	}
}
