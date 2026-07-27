package ai

import "sync"

type activationCommitDisposition uint8

const (
	activationCommitDeliver activationCommitDisposition = iota
	activationCommitWindowClosed
	activationCommitCallerCancelled
)

func (lease *activationLease) BeginCommit() (func(), error) {
	if err := lease.Validate(); err != nil {
		return nil, err
	}
	gate := lease.gate
	gate.mu.Lock()
	state := gate.windows[lease.window]
	if gate.closed || state == nil || state.tombstoned || state.active != lease || lease.committing {
		gate.mu.Unlock()
		return nil, ErrWindowUnavailable
	}
	lease.committing = true
	gate.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			gate.mu.Lock()
			lease.committing = false
			gate.mu.Unlock()
		})
	}, nil
}

func (lease *activationLease) CommitDisposition() activationCommitDisposition {
	if lease == nil || lease.gate == nil {
		return activationCommitWindowClosed
	}
	gate := lease.gate
	gate.mu.Lock()
	state := gate.windows[lease.window]
	windowClosed := gate.closed || state == nil || state.tombstoned ||
		state.generation != lease.generation || state.active != lease || !lease.committing
	callerCancelled := !windowClosed && lease.ctx.Err() != nil
	gate.mu.Unlock()
	if windowClosed {
		return activationCommitWindowClosed
	}
	if callerCancelled {
		return activationCommitCallerCancelled
	}
	return activationCommitDeliver
}

func (lease *activationLease) WasTombstoned() bool {
	if lease == nil || lease.gate == nil {
		return false
	}
	gate := lease.gate
	gate.mu.Lock()
	state := gate.windows[lease.window]
	tombstoned := gate.closed || state != nil && state.tombstoned && state.generation != lease.generation
	gate.mu.Unlock()
	return tombstoned
}
