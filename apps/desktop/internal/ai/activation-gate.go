package ai

import (
	"context"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type activationGate struct {
	mu      sync.Mutex
	windows map[session.WindowID]*activationWindowState
	closed  bool
}

type activationWindowState struct {
	generation uint64
	active     *activationLease
	tombstoned bool
}

type activationLease struct {
	once       sync.Once
	gate       *activationGate
	window     session.WindowID
	generation uint64
	ctx        context.Context
	cancel     context.CancelFunc
	committing bool
}

func newActivationGate() *activationGate {
	return &activationGate{windows: make(map[session.WindowID]*activationWindowState)}
}

func (gate *activationGate) Acquire(parent context.Context, window session.WindowID) (*activationLease, error) {
	if gate == nil || parent == nil || parent.Err() != nil || window == 0 {
		return nil, ErrWindowUnavailable
	}
	ctx, cancel := context.WithCancel(parent)
	gate.mu.Lock()
	state := gate.windows[window]
	if gate.closed || state != nil && state.tombstoned {
		gate.mu.Unlock()
		cancel()
		return nil, ErrWindowUnavailable
	}
	if state == nil {
		state = &activationWindowState{}
		gate.windows[window] = state
	}
	if state.active != nil {
		gate.mu.Unlock()
		cancel()
		return nil, ErrActivationBusy
	}
	state.generation++
	lease := &activationLease{gate: gate, window: window, generation: state.generation,
		ctx: ctx, cancel: cancel}
	state.active = lease
	gate.mu.Unlock()
	return lease, nil
}

func (lease *activationLease) Context() context.Context {
	if lease == nil {
		return nil
	}
	return lease.ctx
}

func (lease *activationLease) Validate() error {
	if lease == nil || lease.ctx == nil || lease.ctx.Err() != nil {
		return ErrWindowUnavailable
	}
	gate := lease.gate
	gate.mu.Lock()
	state := gate.windows[lease.window]
	valid := !gate.closed && state != nil && !state.tombstoned &&
		state.generation == lease.generation && state.active == lease
	gate.mu.Unlock()
	if !valid {
		return ErrWindowUnavailable
	}
	return nil
}

func (lease *activationLease) Finish() {
	if lease == nil {
		return
	}
	lease.once.Do(func() {
		gate := lease.gate
		gate.mu.Lock()
		state := gate.windows[lease.window]
		if state != nil && state.active == lease && state.generation == lease.generation {
			state.active = nil
		}
		gate.mu.Unlock()
		lease.cancel()
	})
}

func (gate *activationGate) CloseWindow(window session.WindowID) {
	var cancel context.CancelFunc
	gate.mu.Lock()
	state := gate.windows[window]
	if state == nil {
		state = &activationWindowState{}
		gate.windows[window] = state
	}
	state.tombstoned = true
	state.generation++
	if state.active != nil {
		cancel = state.active.cancel
		state.active = nil
	}
	gate.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (gate *activationGate) Close() {
	cancels := []context.CancelFunc{}
	gate.mu.Lock()
	gate.closed = true
	for _, state := range gate.windows {
		state.tombstoned = true
		state.generation++
		if state.active != nil {
			cancels = append(cancels, state.active.cancel)
			state.active = nil
		}
	}
	gate.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}
