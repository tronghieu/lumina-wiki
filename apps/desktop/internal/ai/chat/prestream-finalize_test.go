package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type fixedRetriever struct {
	lexical *retrieval.Lexical
	result  HybridResult
	err     error
}

func (r fixedRetriever) Retrieve(context.Context, string, retrieval.SearchOptions) (HybridResult, error) {
	return r.result, r.err
}
func (r fixedRetriever) Lexical() *retrieval.Lexical { return r.lexical }

func TestOrchestratorRetrievalFailureAppendsAndEmitsOneTerminal(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	provider, appender := &scriptedProvider{}, &appendSpy{}
	var events []Event
	err := NewOrchestrator(OrchestratorConfig{Retriever: fixedRetriever{lexical: lexical, err: retrieval.ErrStaleIndex}, Provider: provider, History: appender, Clock: func() time.Time { return time.Unix(10, 0) }}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error { events = append(events, event); return nil }))
	if err == nil || appender.calls != 1 || appender.record.ErrorCode != "retrieval_failed" || provider.request.Model != "" || len(events) != 2 || events[1].Kind != EventFailed {
		t.Fatalf("err=%v append=%#v provider=%#v events=%#v", err, appender, provider.request, events)
	}
}

func TestOrchestratorEvidenceAndContextFailuresFinalize(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	search, _ := lexical.Search(context.Background(), "needle", retrieval.SearchOptions{})
	forged := append([]retrieval.Hit(nil), search.Hits...)
	forged[0].ID = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	tests := []struct {
		name, code string
		config     OrchestratorConfig
	}{
		{"evidence", "evidence_failed", OrchestratorConfig{Retriever: fixedRetriever{lexical: lexical, result: HybridResult{Hits: forged}}, Provider: &scriptedProvider{}}},
		{"context", "context_failed", OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Builder: ContextBuilder{RequestByteLimit: 1}, Provider: &scriptedProvider{}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			appender := &appendSpy{}
			tc.config.History, tc.config.Clock = appender, func() time.Time { return time.Unix(10, 0) }
			var terminal Event
			err := NewOrchestrator(tc.config).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
				if isTerminal(event.Kind) {
					terminal = event
				}
				return nil
			}))
			if err == nil || appender.calls != 1 || appender.record.ErrorCode != tc.code || terminal.ErrorCode != tc.code {
				t.Fatalf("err=%v append=%#v terminal=%#v", err, appender, terminal)
			}
		})
	}
}

func TestOrchestratorStartSinkFailureStillAppendsOnce(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	provider, appender := &scriptedProvider{}, &appendSpy{}
	started := false
	sink := eventSinkFunc(func(_ context.Context, event Event) error {
		if event.Kind == EventStarted && !started {
			started = true
			return errors.New("start sink")
		}
		return nil
	})
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: provider, History: appender, Clock: func() time.Time { return time.Unix(10, 0) }}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, sink)
	if err == nil || appender.calls != 1 || appender.record.Status != history.StatusFailed || appender.record.ErrorCode != "stream_start_failed" || provider.request.Model != "" {
		t.Fatalf("err=%v append=%#v provider=%#v", err, appender, provider.request)
	}
}
