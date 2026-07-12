package index

import (
	"context"
	"os"
	"sync"
)

type indexGate struct {
	token chan struct{}
	refs  int
}

var indexGates = struct {
	sync.Mutex
	items map[string]*indexGate
}{items: map[string]*indexGate{}}

func acquireIndexGate(ctx context.Context, key string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	indexGates.Lock()
	gate := indexGates.items[key]
	if gate == nil {
		gate = &indexGate{token: make(chan struct{}, 1)}
		gate.token <- struct{}{}
		indexGates.items[key] = gate
	}
	gate.refs++
	indexGates.Unlock()
	select {
	case <-ctx.Done():
		releaseIndexGateRef(key, gate)
		return nil, ctx.Err()
	case <-gate.token:
		var once sync.Once
		return func() { once.Do(func() { gate.token <- struct{}{}; releaseIndexGateRef(key, gate) }) }, nil
	}
}

func releaseIndexGateRef(key string, gate *indexGate) {
	indexGates.Lock()
	defer indexGates.Unlock()
	gate.refs--
	if gate.refs == 0 && indexGates.items[key] == gate {
		delete(indexGates.items, key)
	}
}

// Lock order: process workspace gate, advisory kernel lock, workspace root I/O.
func (store *Store) withLocked(ctx context.Context, action func(*os.Root) error) error {
	releaseGate, err := acquireIndexGate(ctx, store.key)
	if err != nil {
		return err
	}
	defer releaseGate()
	root, err := store.openRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	releaseLock, err := store.acquireLock(ctx, root)
	if err != nil {
		return err
	}
	defer releaseLock()
	if err := store.cleanupTemps(root); err != nil {
		return err
	}
	if err := validateIndexEntries(root); err != nil {
		return err
	}
	return action(root)
}
