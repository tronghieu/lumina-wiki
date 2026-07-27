package history

import (
	"context"
	"os"
	"sync"
)

type processGate struct {
	token chan struct{}
	refs  int
}

var gateRegistry = struct {
	sync.Mutex
	items map[string]*processGate
}{items: map[string]*processGate{}}

func acquireProcessGate(ctx context.Context, key string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	gateRegistry.Lock()
	gate := gateRegistry.items[key]
	if gate == nil {
		gate = &processGate{token: make(chan struct{}, 1)}
		gate.token <- struct{}{}
		gateRegistry.items[key] = gate
	}
	gate.refs++
	gateRegistry.Unlock()
	select {
	case <-ctx.Done():
		releaseGateRef(key, gate)
		return nil, ctx.Err()
	case <-gate.token:
		var once sync.Once
		return func() { once.Do(func() { gate.token <- struct{}{}; releaseGateRef(key, gate) }) }, nil
	}
}

func releaseGateRef(key string, gate *processGate) {
	gateRegistry.Lock()
	defer gateRegistry.Unlock()
	gate.refs--
	if gate.refs == 0 && gateRegistry.items[key] == gate {
		delete(gateRegistry.items, key)
	}
}

func processGateCount() int {
	gateRegistry.Lock()
	defer gateRegistry.Unlock()
	return len(gateRegistry.items)
}

// Lock order: process gate -> stable history-root advisory lock -> workspace root I/O.
func (store *HistoryStore) withLocked(ctx context.Context, action func(*os.Root) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	releaseGate, err := acquireProcessGate(ctx, store.key)
	if err != nil {
		return err
	}
	defer releaseGate()
	historyRoot, err := store.openHistoryRoot()
	if err != nil {
		return err
	}
	defer historyRoot.Close()
	releaseLock, err := store.acquireAdvisoryRoot(ctx, historyRoot)
	if err != nil {
		return err
	}
	defer releaseLock()
	workspace, err := store.openWorkspace(historyRoot)
	if err != nil {
		return err
	}
	defer workspace.Close()
	store.workspaceHook()
	if err := store.cleanupTemps(workspace); err != nil {
		return err
	}
	store.operations.Add(1)
	return action(workspace)
}

func (store *HistoryStore) mutate(ctx context.Context, action func(*os.Root) error) error {
	return store.withLocked(ctx, action)
}
