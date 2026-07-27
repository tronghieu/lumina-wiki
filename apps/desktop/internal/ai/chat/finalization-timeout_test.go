package chat

import (
	"context"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

type blockingAppender struct {
	calls  int
	record history.ConversationRecord
}

func (appender *blockingAppender) Append(ctx context.Context, record history.ConversationRecord) (history.AppendOutcome, error) {
	appender.calls++
	appender.record = record
	<-ctx.Done()
	return "", ctx.Err()
}

func TestOrchestratorBlockingHistoryUsesBoundedFinalization(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	appender := &blockingAppender{}
	var terminal Event
	started := time.Now()
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, History: appender, FinalizationTimeout: 20 * time.Millisecond}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
		if isTerminal(event.Kind) {
			terminal = event
		}
		return nil
	}))
	if time.Since(started) > time.Second || err == nil || appender.calls != 1 || terminal.ErrorCode != "history_write_timeout" {
		t.Fatalf("elapsed=%v err=%v calls=%d terminal=%#v", time.Since(started), err, appender.calls, terminal)
	}
}

func TestOrchestratorHistoryTimeoutStillUsesFreshTerminalContext(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	appender := &blockingAppender{}
	var terminal Event
	sink := eventSinkFunc(func(ctx context.Context, event Event) error {
		if isTerminal(event.Kind) {
			if err := ctx.Err(); err != nil {
				return err
			}
			terminal = event
		}
		return nil
	})
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, History: appender, FinalizationTimeout: 20 * time.Millisecond}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, sink)
	if err == nil || terminal.ErrorCode != "history_write_timeout" || appender.calls != 1 {
		t.Fatalf("err=%v terminal=%#v calls=%d", err, terminal, appender.calls)
	}
}

func TestOrchestratorBlockingTerminalSinkUsesBoundedFinalization(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	appender := &appendSpy{}
	started := time.Now()
	sink := eventSinkFunc(func(ctx context.Context, event Event) error {
		if isTerminal(event.Kind) {
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	})
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, History: appender, FinalizationTimeout: 20 * time.Millisecond}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, sink)
	if time.Since(started) > time.Second || err != ErrSink || appender.calls != 1 || appender.record.Status != history.StatusCompleted {
		t.Fatalf("elapsed=%v err=%v append=%#v", time.Since(started), err, appender)
	}
}
