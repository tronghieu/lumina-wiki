package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

func TestOrchestratorCitationSinkFailureIsRecordedBeforeTerminal(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	appender := &appendSpy{}
	var terminal Event
	sink := eventSinkFunc(func(_ context.Context, event Event) error {
		if event.Kind == EventCitation {
			return errors.New("citation sink")
		}
		if isTerminal(event.Kind) {
			terminal = event
		}
		return nil
	})
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, History: appender, Clock: func() time.Time { return time.Unix(10, 0) }}).Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, sink)
	if err == nil || appender.calls != 1 || appender.record.Status != history.StatusFailed || appender.record.ErrorCode != "sink_failed" || terminal.Kind != EventFailed {
		t.Fatalf("err=%v append=%#v terminal=%#v", err, appender, terminal)
	}
}

func TestOrchestratorTerminalSinkFailureDoesNotRewriteHistory(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	appender := &appendSpy{outcome: history.AppendIdempotent}
	sink := eventSinkFunc(func(_ context.Context, event Event) error {
		if isTerminal(event.Kind) {
			return errors.New("terminal sink")
		}
		return nil
	})
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, History: appender, Clock: func() time.Time { return time.Unix(10, 0) }}).Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, sink)
	if err != ErrSink || appender.calls != 1 || appender.record.Status != history.StatusCompleted {
		t.Fatalf("err=%v append=%#v", err, appender)
	}
}

func TestOrchestratorEmptyDeltaEndsAsEmptyCompletion(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	provider := chatProviderFunc(func(ctx context.Context, _ providers.ChatRequest, sink providers.StreamSink) error {
		return sink.OnEvent(ctx, providers.StreamEvent{Kind: providers.EventDelta, Delta: &providers.Delta{Text: ""}})
	})
	appender := &appendSpy{}
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: provider, History: appender, Clock: func() time.Time { return time.Unix(10, 0) }}).Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(context.Context, Event) error { return nil }))
	if err == nil || appender.record.ErrorCode != "empty_completion" {
		t.Fatalf("err=%v record=%#v", err, appender.record)
	}
}
