package chat

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type scriptedProvider struct{ request providers.ChatRequest }

func (provider *scriptedProvider) Stream(ctx context.Context, request providers.ChatRequest, sink providers.StreamSink) error {
	provider.request = request
	if err := sink.OnEvent(ctx, providers.StreamEvent{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "answer [S1]"}}); err != nil {
		return err
	}
	return sink.OnEvent(ctx, providers.StreamEvent{Kind: providers.EventUsage, Usage: &providers.Usage{InputTokens: 2, OutputTokens: 3, TotalTokens: 5}})
}

type appendSpy struct {
	calls   int
	record  history.ConversationRecord
	err     error
	outcome history.AppendOutcome
}

func (appender *appendSpy) Append(_ context.Context, record history.ConversationRecord) (history.AppendOutcome, error) {
	appender.calls++
	appender.record = record
	if appender.outcome == "" {
		appender.outcome = history.AppendStored
	}
	return appender.outcome, appender.err
}

type noEventProvider struct{}

func (noEventProvider) Stream(context.Context, providers.ChatRequest, providers.StreamSink) error {
	return nil
}

func TestOrchestratorRequiresHistoryAppenderBeforeRetrieval(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	provider := &scriptedProvider{}
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: provider}).Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(context.Context, Event) error { return nil }))
	if err != ErrInvalidRequest || provider.request.Model != "" {
		t.Fatalf("err=%v provider=%#v", err, provider.request)
	}
}

func TestOrchestratorEmptyCompletionFailsAndAppendsOnce(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	appender := &appendSpy{}
	var terminal Event
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: noEventProvider{}, History: appender, Clock: func() time.Time { return time.Unix(10, 0) }}).Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
		if isTerminal(event.Kind) {
			terminal = event
		}
		return nil
	}))
	if err == nil || terminal.Kind != EventFailed || terminal.ErrorCode != "empty_completion" || appender.calls != 1 || appender.record.Status != history.StatusFailed {
		t.Fatalf("err=%v terminal=%#v append=%#v", err, terminal, appender)
	}
}

func TestOrchestratorContextOmittedCitationIsNotAccepted(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle first", "wiki/b.md": "needle second"})
	search, _ := lexical.Search(context.Background(), "needle", retrieval.SearchOptions{})
	probe, _ := NewEvidenceAllowlist(context.Background(), lexical, search.Hits, retrieval.CitationOptions{})
	profile := chatProfile()
	profile.MaxEvidenceChars = utf8.RuneCountInString(emptyEvidenceSystem()) + utf8.RuneCountInString(evidenceJSONLine(probe.entries[0]))
	probe.Close()
	chatProvider := chatProviderFunc(func(ctx context.Context, request providers.ChatRequest, sink providers.StreamSink) error {
		return sink.OnEvent(ctx, providers.StreamEvent{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "answer [S2]"}})
	})
	appender := &appendSpy{}
	var citations int
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: chatProvider, History: appender, Clock: func() time.Time { return time.Unix(10, 0) }}).Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: profile, HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
		if event.Kind == EventCitation {
			citations++
		}
		return nil
	}))
	if err != nil || citations != 0 || len(appender.record.Citations) != 0 {
		t.Fatalf("err=%v citations=%d record=%#v", err, citations, appender.record)
	}
}

type chatProviderFunc func(context.Context, providers.ChatRequest, providers.StreamSink) error

func (f chatProviderFunc) Stream(ctx context.Context, request providers.ChatRequest, sink providers.StreamSink) error {
	return f(ctx, request, sink)
}

func TestOrchestratorAppendDisabledBecomesHistoryWriteFailure(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	appender := &appendSpy{outcome: history.AppendDisabled}
	var terminal Event
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, History: appender, Clock: func() time.Time { return time.Unix(10, 0) }}).Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
		if isTerminal(event.Kind) {
			terminal = event
		}
		return nil
	}))
	if err == nil || appender.calls != 1 || terminal.ErrorCode != "history_write_failed" {
		t.Fatalf("err=%v calls=%d terminal=%#v", err, appender.calls, terminal)
	}
}

func TestOrchestratorStreamsCitationsUsageCompletionAndAppendsOnce(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "# A\n\nneedle evidence"})
	provider, appender := &scriptedProvider{}, &appendSpy{}
	orchestrator := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Builder: ContextBuilder{}, Provider: provider, History: appender, Clock: func() time.Time { return time.Unix(10, 0).UTC() }})
	var events []Event
	err := orchestrator.Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle?", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error { events = append(events, event); return nil }))
	if err != nil {
		t.Fatal(err)
	}
	want := []EventKind{EventStarted, EventDelta, EventCitation, EventUsage, EventCompleted}
	if len(events) != len(want) {
		t.Fatalf("events=%#v", events)
	}
	for i := range want {
		if events[i].Kind != want[i] || events[i].Seq != uint64(i+1) {
			t.Fatalf("events=%#v", events)
		}
	}
	if appender.calls != 1 || appender.record.Status != history.StatusCompleted || appender.record.AssistantOutput != "answer [S1]" || len(appender.record.Citations) != 1 {
		t.Fatalf("append=%d %#v", appender.calls, appender.record)
	}
	if provider.request.Model != chatProfile().Model {
		t.Fatalf("request=%#v", provider.request)
	}
}

func TestOrchestratorRejectsBeforeDependencies(t *testing.T) {
	orchestrator := NewOrchestrator(OrchestratorConfig{})
	if err := orchestrator.Run(context.Background(), Request{}, eventSinkFunc(func(context.Context, Event) error { t.Fatal("sink called"); return nil })); err != ErrInvalidRequest {
		t.Fatalf("err=%v", err)
	}
}

func TestOrchestratorAppendFailureEmitsOneFailedTerminal(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	appender := &appendSpy{err: errors.New("disk /secret/path")}
	orchestrator := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, History: appender, Clock: func() time.Time { return time.Unix(10, 0).UTC() }})
	var terminals int
	err := orchestrator.Run(context.Background(), Request{RequestID: "req", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile(), HistoryEnabled: true}, eventSinkFunc(func(_ context.Context, event Event) error {
		if isTerminal(event.Kind) {
			terminals++
			if event.Kind != EventFailed || event.ErrorCode != "history_write_failed" {
				t.Fatalf("terminal=%#v", event)
			}
		}
		return nil
	}))
	if err == nil || appender.calls != 1 || terminals != 1 || strings.Contains(err.Error(), "secret") {
		t.Fatalf("err=%v calls=%d terminals=%d", err, appender.calls, terminals)
	}
}
