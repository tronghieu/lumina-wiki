package history

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestIndependentStoresDoNotLoseConcurrentAttempts(t *testing.T) {
	base := t.TempDir()
	id := workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef")
	first, _ := NewHistoryStore(base, id)
	second, _ := NewHistoryStore(base, id)
	_ = first.SetEnabled(context.Background(), true)
	var wait sync.WaitGroup
	wait.Add(2)
	for _, item := range []struct {
		store   *HistoryStore
		attempt string
	}{{first, "attempt-a"}, {second, "attempt-b"}} {
		go func() {
			defer wait.Done()
			_, _ = item.store.Append(context.Background(), validRecord("conversation-a", item.attempt))
		}()
	}
	wait.Wait()
	attempts, err := first.Load(context.Background(), "conversation-a")
	if err != nil || len(attempts) != 2 {
		t.Fatalf("lost concurrent append: %#v %v", attempts, err)
	}
}

func TestCancelledMutationWaitingForProcessGateDoesNoIO(t *testing.T) {
	store := enabledTestStore(t)
	release, err := acquireProcessGate(context.Background(), store.key)
	if err != nil {
		t.Fatalf("hold gate: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before := store.ioCount()
	if _, err := store.Append(ctx, validRecord("conversation-a", "attempt-a")); err == nil {
		t.Fatal("expected cancellation")
	}
	if after := store.ioCount(); after != before {
		t.Fatalf("cancelled wait performed I/O: %d -> %d", before, after)
	}
	release()
}

func TestDifferentWorkspaceGatesProceedIndependently(t *testing.T) {
	base := t.TempDir()
	first, _ := NewHistoryStore(base, workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef"))
	second, _ := NewHistoryStore(base, workspaceid.WorkspaceID("ws_fedcba9876543210fedcba9876543210"))
	release, _ := acquireProcessGate(context.Background(), first.key)
	done := make(chan error, 1)
	go func() { done <- second.SetEnabled(context.Background(), true) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("different workspace blocked: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("different workspace gate was blocked")
	}
	release()
}
