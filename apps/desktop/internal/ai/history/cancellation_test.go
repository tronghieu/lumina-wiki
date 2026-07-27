package history

import (
	"context"
	"sync/atomic"
	"testing"
)

func TestPreCancelledMutationsDeterministicallyPerformZeroBackendIO(t *testing.T) {
	store := newTestStore(t)
	var calls atomic.Int64
	store.ioHook = func() { calls.Add(1) }
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	methods := []struct {
		name string
		call func() error
	}{
		{"append", func() error { _, err := store.Append(ctx, validRecord("conversation-a", "attempt-a")); return err }},
		{"set enabled", func() error { return store.SetEnabled(ctx, true) }},
		{"delete", func() error { _, err := store.Delete(ctx, "conversation-a"); return err }},
		{"delete all", func() error { _, err := store.DeleteAll(ctx); return err }},
	}
	for range 100 {
		for _, method := range methods {
			before := calls.Load()
			if err := method.call(); err != context.Canceled {
				t.Fatalf("%s returned %v, want context.Canceled", method.name, err)
			}
			if after := calls.Load(); after != before {
				t.Fatalf("%s performed backend I/O: %d -> %d", method.name, before, after)
			}
		}
	}
}
