package chat

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestTerminalGuardPreservesQueuedTerminalWhenBlockedNonterminalSinkFails(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var mu sync.Mutex
	var events []Event
	guard := NewTerminalGuard(eventSinkFunc(func(_ context.Context, event Event) error {
		mu.Lock()
		events = append(events, event)
		mu.Unlock()
		if event.Kind == EventDelta {
			close(entered)
			<-release
			return errors.New("delta sink failed")
		}
		return nil
	}), GuardLimits{})
	if err := guard.Start(context.Background(), "request", "conversation", retrievalStatus()); err != nil {
		t.Fatal(err)
	}
	emitDone := make(chan error, 1)
	go func() { emitDone <- guard.Emit(context.Background(), Event{Kind: EventDelta, Delta: "blocked"}) }()
	<-entered
	if err := guard.Finalize(context.Background(), Event{Kind: EventCompleted}); err != nil {
		t.Fatalf("queued terminal: %v", err)
	}
	close(release)
	if err := <-emitDone; err != ErrSink {
		t.Fatalf("emit err=%v", err)
	}
	if err := guard.Emit(context.Background(), Event{Kind: EventDelta, Delta: "late"}); err != nil {
		t.Fatalf("late err=%v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	terminals := 0
	for i, event := range events {
		if event.Seq != uint64(i+1) {
			t.Fatalf("events=%#v", events)
		}
		if isTerminal(event.Kind) {
			terminals++
			if event.Kind != EventCompleted || event.ErrorCode != "" || i != len(events)-1 {
				t.Fatalf("events=%#v", events)
			}
		}
	}
	if terminals != 1 || len(events) != 3 {
		t.Fatalf("events=%#v", events)
	}
}
