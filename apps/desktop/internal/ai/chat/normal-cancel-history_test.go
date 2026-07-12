package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

type waitForCancelProvider struct{}

func (waitForCancelProvider) Stream(ctx context.Context, _ providers.ChatRequest, _ providers.StreamSink) error {
	<-ctx.Done()
	return errors.New("provider domain failure")
}

func TestNormalCancellationSurvivesHistoryFailureAndTimeout(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	tests := []struct {
		name, code string
		parent     func() (context.Context, context.CancelFunc)
		appender   HistoryAppender
	}{
		{"cancel_failing", "cancelled", func() (context.Context, context.CancelFunc) {
			ctx, cancel := context.WithCancel(context.Background())
			go func() { time.Sleep(5 * time.Millisecond); cancel() }()
			return ctx, cancel
		}, &appendSpy{err: errors.New("history failure")}},
		{"deadline_blocking", "deadline_exceeded", func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(context.Background(), 5*time.Millisecond)
		}, &blockingAppender{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := tc.parent()
			defer cancel()
			var terminal Event
			err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: waitForCancelProvider{}, History: tc.appender, FinalizationTimeout: 20 * time.Millisecond}).Run(ctx, Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
				if isTerminal(event.Kind) {
					terminal = event
				}
				return nil
			}))
			var record history.ConversationRecord
			calls := 0
			switch appender := tc.appender.(type) {
			case *appendSpy:
				record, calls = appender.record, appender.calls
			case *blockingAppender:
				record, calls = appender.record, appender.calls
			}
			if err == nil || calls != 1 || record.Status != history.StatusCancelled || record.ErrorCode != tc.code || terminal.Kind != EventCancelled || terminal.ErrorCode != tc.code {
				t.Fatalf("err=%v calls=%d record=%#v terminal=%#v", err, calls, record, terminal)
			}
		})
	}
}
