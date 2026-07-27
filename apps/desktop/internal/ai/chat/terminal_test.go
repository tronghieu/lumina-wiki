package chat

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

type eventSinkFunc func(context.Context, Event) error

func (f eventSinkFunc) OnEvent(ctx context.Context, event Event) error { return f(ctx, event) }

func TestTerminalGuardAssignsSequenceAndIgnoresLateEvents(t *testing.T) {
	var events []Event
	guard := NewTerminalGuard(eventSinkFunc(func(_ context.Context, event Event) error {
		events = append(events, event)
		return nil
	}), GuardLimits{})
	ctx := context.Background()
	if err := guard.Start(ctx, "request", "conversation", retrievalStatus()); err != nil {
		t.Fatal(err)
	}
	if err := guard.Emit(ctx, Event{Kind: EventDelta, Delta: "hello"}); err != nil {
		t.Fatal(err)
	}
	if err := guard.Finalize(ctx, Event{Kind: EventCompleted}); err != nil {
		t.Fatal(err)
	}
	if err := guard.Emit(ctx, Event{Kind: EventDelta, Delta: "late"}); err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[0].Seq != 1 || events[2].Seq != 3 || events[2].Kind != EventCompleted {
		t.Fatalf("events=%#v", events)
	}
}

func TestTerminalGuardSinkFailureCancelsAndFinalizesOnce(t *testing.T) {
	cancelled := false
	guard := NewTerminalGuard(eventSinkFunc(func(_ context.Context, event Event) error {
		if event.Kind == EventDelta {
			return errors.New("sink secret")
		}
		return nil
	}), GuardLimits{Cancel: func() { cancelled = true }})
	_ = guard.Start(context.Background(), "request", "conversation", retrievalStatus())
	if err := guard.Emit(context.Background(), Event{Kind: EventDelta, Delta: "x"}); err == nil || !cancelled {
		t.Fatalf("err=%v cancelled=%v", err, cancelled)
	}
	_ = guard.Finalize(context.Background(), Event{Kind: EventFailed, ErrorCode: "provider_error"})
	_ = guard.Finalize(context.Background(), Event{Kind: EventCancelled, ErrorCode: "cancelled"})
	if !guard.Terminal() {
		t.Fatal("not terminal")
	}
}

func retrievalStatus() SemanticInfo { return SemanticInfo{Status: "disabled"} }

func TestTerminalGuardConcurrentFinalizeIsOrderedAndUnique(t *testing.T) {
	for run := 0; run < 100; run++ {
		var mu sync.Mutex
		var events []Event
		guard := NewTerminalGuard(eventSinkFunc(func(_ context.Context, event Event) error {
			mu.Lock()
			events = append(events, event)
			mu.Unlock()
			return nil
		}), GuardLimits{})
		if err := guard.Start(context.Background(), "request", "conversation", retrievalStatus()); err != nil {
			t.Fatal(err)
		}
		var wait sync.WaitGroup
		for i := 0; i < 8; i++ {
			wait.Add(1)
			go func() { defer wait.Done(); _ = guard.Emit(context.Background(), Event{Kind: EventDelta, Delta: "x"}) }()
		}
		for i := 0; i < 8; i++ {
			wait.Add(1)
			go func() { defer wait.Done(); _ = guard.Finalize(context.Background(), Event{Kind: EventCompleted}) }()
		}
		wait.Wait()
		mu.Lock()
		terminals := 0
		for i, event := range events {
			if event.Seq != uint64(i+1) {
				t.Fatalf("events=%#v", events)
			}
			if isTerminal(event.Kind) {
				terminals++
				if i != len(events)-1 {
					t.Fatalf("late event=%#v", events)
				}
			}
		}
		mu.Unlock()
		if terminals != 1 {
			t.Fatalf("terminals=%d events=%#v", terminals, events)
		}
	}
}

func TestTerminalGuardReentrantSinkDoesNotDeadlock(t *testing.T) {
	var guard *TerminalGuard
	var events []Event
	guard = NewTerminalGuard(eventSinkFunc(func(ctx context.Context, event Event) error {
		events = append(events, event)
		if event.Kind == EventStarted {
			return guard.Emit(ctx, Event{Kind: EventDelta, Delta: "nested"})
		}
		return nil
	}), GuardLimits{})
	if err := guard.Start(context.Background(), "request", "conversation", retrievalStatus()); err != nil {
		t.Fatal(err)
	}
	if err := guard.Finalize(context.Background(), Event{Kind: EventCompleted}); err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[1].Delta != "nested" {
		t.Fatalf("events=%#v", events)
	}
}

func TestTerminalGuardAcceptsHistoryCompatibleIdentifiers(t *testing.T) {
	guard := NewTerminalGuard(eventSinkFunc(func(context.Context, Event) error { return nil }), GuardLimits{})
	if err := guard.Start(context.Background(), "Request_1", "conversation-uuid", retrievalStatus()); err != nil {
		t.Fatalf("err=%v", err)
	}
}

func TestTerminalGuardRejectsExtraPayloadByKind(t *testing.T) {
	allowed := CitationDTO{ModelID: "S1", CitationID: "cit_00000000000000000000000000000000", Path: "wiki/a.md"}
	tests := []Event{
		{Kind: EventDelta, Delta: "x", ErrorCode: "bad"},
		{Kind: EventDelta, Delta: "x", CitationDiagnostics: CitationDiagnostics{Unknown: 1}},
		{Kind: EventDelta, Delta: "x", Semantic: SemanticInfo{Status: "ready"}},
		{Kind: EventCitation, Citation: &allowed, Delta: "x"},
		{Kind: EventUsage, Usage: &providers.Usage{}, ErrorCode: "bad"},
	}
	for _, event := range tests {
		guard := NewTerminalGuard(eventSinkFunc(func(context.Context, Event) error { return nil }), GuardLimits{Citations: []CitationDTO{allowed}})
		if err := guard.Start(context.Background(), "request", "conversation", retrievalStatus()); err != nil {
			t.Fatal(err)
		}
		if err := guard.Emit(context.Background(), event); err != ErrInvalidStream {
			t.Fatalf("event=%#v err=%v", event, err)
		}
	}
}

func TestTerminalGuardRejectsExtraTerminalPayload(t *testing.T) {
	for _, event := range []Event{{Kind: EventCompleted, Semantic: SemanticInfo{Status: "ready"}}, {Kind: EventCompleted, ErrorCode: "bad"}, {Kind: EventFailed}} {
		guard := NewTerminalGuard(eventSinkFunc(func(context.Context, Event) error { return nil }), GuardLimits{})
		if err := guard.Start(context.Background(), "request", "conversation", retrievalStatus()); err != nil {
			t.Fatal(err)
		}
		if err := guard.Finalize(context.Background(), event); err != ErrInvalidStream {
			t.Fatalf("event=%#v err=%v", event, err)
		}
	}
}
