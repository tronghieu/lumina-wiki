package ai

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

func TestChatStreamEventDTOExactJSONForEveryKind(t *testing.T) {
	base := chat.Event{RequestID: "request", ConversationID: "conversation", Seq: 1,
		Semantic: chat.SemanticInfo{Status: "disabled"}}
	tests := []struct {
		name, want string
		event      chat.Event
	}{
		{"started", `{"session":{"sessionId":"sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","generation":1},"event":{"kind":"started","requestId":"request","conversationId":"conversation","seq":1,"semantic":{"status":"disabled"},"citationDiagnostics":{"unknown":0,"malformed":0,"outOfRange":0}}}`, withEventKind(base, chat.EventStarted)},
		{"delta", `{"session":{"sessionId":"sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","generation":1},"event":{"kind":"delta","requestId":"request","conversationId":"conversation","seq":1,"delta":"answer","semantic":{"status":"disabled"},"citationDiagnostics":{"unknown":0,"malformed":0,"outOfRange":0}}}`, withDelta(base, "answer")},
		{"citation", `{"session":{"sessionId":"sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","generation":1},"event":{"kind":"citation","requestId":"request","conversationId":"conversation","seq":1,"citation":{"modelId":"S1","citationId":"cit_0123456789abcdef0123456789abcdef","path":"wiki/a.md","heading":"A","start":0,"end":1},"semantic":{"status":"disabled"},"citationDiagnostics":{"unknown":0,"malformed":0,"outOfRange":0}}}`, withCitation(base)},
		{"usage", `{"session":{"sessionId":"sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","generation":1},"event":{"kind":"usage","requestId":"request","conversationId":"conversation","seq":1,"usage":{"inputTokens":2,"outputTokens":3,"totalTokens":5},"semantic":{"status":"disabled"},"citationDiagnostics":{"unknown":0,"malformed":0,"outOfRange":0}}}`, withUsage(base)},
		{"completed", `{"session":{"sessionId":"sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","generation":1},"event":{"kind":"completed","requestId":"request","conversationId":"conversation","seq":1,"semantic":{"status":"disabled"},"citationDiagnostics":{"unknown":1,"malformed":2,"outOfRange":3}}}`, withTerminal(base, chat.EventCompleted, "")},
		{"failed", `{"session":{"sessionId":"sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","generation":1},"event":{"kind":"failed","requestId":"request","conversationId":"conversation","seq":1,"errorCode":"provider_error","semantic":{"status":"disabled"},"citationDiagnostics":{"unknown":1,"malformed":2,"outOfRange":3}}}`, withTerminal(base, chat.EventFailed, "provider_error")},
		{"cancelled", `{"session":{"sessionId":"sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","generation":1},"event":{"kind":"cancelled","requestId":"request","conversationId":"conversation","seq":1,"errorCode":"cancelled","semantic":{"status":"disabled"},"citationDiagnostics":{"unknown":1,"malformed":2,"outOfRange":3}}}`, withTerminal(base, chat.EventCancelled, "cancelled")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dispatcher := &eventDispatcherStub{}
			sink, _ := newWailsStreamSink(dispatcher, sinkReference())
			if err := sink.OnEvent(context.Background(), test.event); err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(dispatcher.snapshot()[0].Data)
			if err != nil || string(raw) != test.want {
				t.Fatalf("json=%s err=%v", raw, err)
			}
			var decoded map[string]any
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatal(err)
			}
			assertLowerCamelKeys(t, decoded)
		})
	}
}

func TestChatStreamDTOsDoNotEmbedInternalEventOrUsageTypes(t *testing.T) {
	eventType := reflect.TypeOf(ChatStreamEventDTO{})
	if eventType == reflect.TypeOf(chat.Event{}) || reflect.TypeOf(ChatEventDTO{}.Event) == reflect.TypeOf(chat.Event{}) {
		t.Fatal("frontend envelope embeds chat.Event")
	}
	usage, _ := eventType.FieldByName("Usage")
	if usage.Type == reflect.TypeOf((*providers.Usage)(nil)) {
		t.Fatal("frontend event embeds providers.Usage")
	}
	raw, _ := json.Marshal(ChatStreamEventDTO{Usage: &UsageDTO{InputTokens: 1, OutputTokens: 2, TotalTokens: 3}})
	for _, forbidden := range []string{"InputTokens", "OutputTokens", "TotalTokens"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("internal field leaked: %s", raw)
		}
	}
}

func TestWailsStreamSinkDeepCopiesInternalPointersBeforeDispatch(t *testing.T) {
	for _, event := range []chat.Event{withCitation(validChatEvent("citation-copy")), withUsage(validChatEvent("usage-copy"))} {
		dispatcher := &eventDispatcherStub{}
		sink, _ := newWailsStreamSink(dispatcher, sinkReference())
		if err := sink.OnEvent(context.Background(), event); err != nil {
			t.Fatal(err)
		}
		captured := dispatcher.snapshot()[0].Data.(ChatEventDTO)
		if event.Citation != nil {
			event.Citation.Path = "wiki/mutated.md"
			if captured.Event.Citation.Path != "wiki/a.md" {
				t.Fatal("captured citation aliases internal pointer")
			}
		}
		if event.Usage != nil {
			event.Usage.InputTokens = 999
			if captured.Event.Usage.InputTokens != 2 {
				t.Fatal("captured usage aliases internal pointer")
			}
		}
	}
}

func withEventKind(event chat.Event, kind chat.EventKind) chat.Event { event.Kind = kind; return event }
func withDelta(event chat.Event, delta string) chat.Event {
	event.Kind, event.Delta = chat.EventDelta, delta
	return event
}
func withCitation(event chat.Event) chat.Event {
	event.Kind = chat.EventCitation
	event.Citation = &chat.CitationDTO{ModelID: "S1", CitationID: bridgeCitationID, Path: "wiki/a.md", Heading: "A", Start: 0, End: 1}
	return event
}
func withUsage(event chat.Event) chat.Event {
	event.Kind, event.Usage = chat.EventUsage, &providers.Usage{InputTokens: 2, OutputTokens: 3, TotalTokens: 5}
	return event
}
func withTerminal(event chat.Event, kind chat.EventKind, code string) chat.Event {
	event.Kind, event.ErrorCode = kind, code
	event.CitationDiagnostics = chat.CitationDiagnostics{Unknown: 1, Malformed: 2, OutOfRange: 3}
	return event
}

func assertLowerCamelKeys(t *testing.T, value any) {
	t.Helper()
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if key == "" || key[0] >= 'A' && key[0] <= 'Z' {
				t.Fatalf("non-lower-camel key %q", key)
			}
			assertLowerCamelKeys(t, child)
		}
	case []any:
		for _, child := range typed {
			assertLowerCamelKeys(t, child)
		}
	}
}
