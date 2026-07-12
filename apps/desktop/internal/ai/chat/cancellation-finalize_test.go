package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type contextBlockingRetriever struct{ lexical *retrieval.Lexical }

func (r contextBlockingRetriever) Retrieve(ctx context.Context, _ string, _ retrieval.SearchOptions) (HybridResult, error) {
	<-ctx.Done()
	return HybridResult{}, ctx.Err()
}
func (r contextBlockingRetriever) Lexical() *retrieval.Lexical { return r.lexical }

type domainErrorAfterCancellationRetriever struct{ lexical *retrieval.Lexical }

func (r domainErrorAfterCancellationRetriever) Retrieve(ctx context.Context, _ string, _ retrieval.SearchOptions) (HybridResult, error) {
	<-ctx.Done()
	return HybridResult{}, errors.New("domain retrieval failure")
}
func (r domainErrorAfterCancellationRetriever) Lexical() *retrieval.Lexical { return r.lexical }

func TestOrchestratorRetrievalCancellationAndDeadlineAreAuthoritative(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	tests := []struct {
		name, code string
		status     history.TerminalStatus
		context    func() (context.Context, context.CancelFunc)
	}{
		{"cancel", "cancelled", history.StatusCancelled, func() (context.Context, context.CancelFunc) {
			ctx, cancel := context.WithCancel(context.Background())
			go func() { time.Sleep(5 * time.Millisecond); cancel() }()
			return ctx, cancel
		}},
		{"deadline", "deadline_exceeded", history.StatusCancelled, func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(context.Background(), 5*time.Millisecond)
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := tc.context()
			defer cancel()
			provider, appender := &scriptedProvider{}, &appendSpy{}
			var terminal Event
			err := NewOrchestrator(OrchestratorConfig{Retriever: contextBlockingRetriever{lexical: lexical}, Provider: provider, History: appender}).Run(ctx, Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
				if isTerminal(event.Kind) {
					terminal = event
				}
				return nil
			}))
			if err == nil || appender.calls != 1 || appender.record.Status != tc.status || appender.record.ErrorCode != tc.code || terminal.Kind != EventCancelled || terminal.ErrorCode != tc.code || provider.request.Model != "" {
				t.Fatalf("err=%v append=%#v terminal=%#v provider=%#v", err, appender, terminal, provider.request)
			}
		})
	}
}

func TestOrchestratorContextStateWinsOverDependencyDomainError(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	for _, tc := range []struct {
		name, code string
		context    func() (context.Context, context.CancelFunc)
	}{
		{"cancel", "cancelled", func() (context.Context, context.CancelFunc) {
			ctx, cancel := context.WithCancel(context.Background())
			go func() { time.Sleep(5 * time.Millisecond); cancel() }()
			return ctx, cancel
		}},
		{"deadline", "deadline_exceeded", func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(context.Background(), 5*time.Millisecond)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := tc.context()
			defer cancel()
			provider, appender := &scriptedProvider{}, &appendSpy{}
			var terminal Event
			err := NewOrchestrator(OrchestratorConfig{Retriever: domainErrorAfterCancellationRetriever{lexical: lexical}, Provider: provider, History: appender}).Run(ctx, Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
				if isTerminal(event.Kind) {
					terminal = event
				}
				return nil
			}))
			if err == nil || appender.calls != 1 || appender.record.Status != history.StatusCancelled || appender.record.ErrorCode != tc.code || terminal.Kind != EventCancelled || terminal.ErrorCode != tc.code || provider.request.Model != "" {
				t.Fatalf("err=%v append=%#v terminal=%#v provider=%#v", err, appender, terminal, provider.request)
			}
		})
	}
}

type successAfterCancelRetriever struct {
	lexical *retrieval.Lexical
	cancel  context.CancelFunc
	result  HybridResult
}

func (r successAfterCancelRetriever) Retrieve(context.Context, string, retrieval.SearchOptions) (HybridResult, error) {
	r.cancel()
	return r.result, nil
}
func (r successAfterCancelRetriever) Lexical() *retrieval.Lexical { return r.lexical }

func TestOrchestratorEvidencePathHonorsParentCancellation(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	search, _ := lexical.Search(context.Background(), "needle", retrieval.SearchOptions{})
	ctx, cancel := context.WithCancel(context.Background())
	provider, appender := &scriptedProvider{}, &appendSpy{}
	var terminal Event
	err := NewOrchestrator(OrchestratorConfig{Retriever: successAfterCancelRetriever{lexical: lexical, cancel: cancel, result: HybridResult{Hits: search.Hits}}, Provider: provider, History: appender}).Run(ctx, Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
		if isTerminal(event.Kind) {
			terminal = event
		}
		return nil
	}))
	if err != context.Canceled || appender.calls != 1 || appender.record.Status != history.StatusCancelled || appender.record.ErrorCode != "cancelled" || terminal.Kind != EventCancelled || provider.request.Model != "" {
		t.Fatalf("err=%v append=%#v terminal=%#v provider=%#v", err, appender, terminal, provider.request)
	}
}
