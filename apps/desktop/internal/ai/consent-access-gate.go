package ai

import (
	"context"
	"sync"
)

// ConsentAccessGate deliberately serializes consent-sensitive reads with
// settings mutations so consumers never observe a transient grant or revoke.
// Waiting mutations take priority over consumers that arrive later.
type ConsentAccessGate struct {
	mu               sync.Mutex
	changed          chan struct{}
	active           bool
	waitingMutations int
}

func NewConsentAccessGate() *ConsentAccessGate {
	return &ConsentAccessGate{changed: make(chan struct{})}
}

func (gate *ConsentAccessGate) BeginUse(ctx context.Context) (func(), error) {
	return gate.acquire(ctx, false)
}

func (gate *ConsentAccessGate) BeginMutation(ctx context.Context) (func(), error) {
	return gate.acquire(ctx, true)
}

func (gate *ConsentAccessGate) acquire(ctx context.Context, mutation bool) (func(), error) {
	if gate == nil || nilLike(ctx) {
		return nil, ErrInvalidInput
	}
	gate.mu.Lock()
	initialized := gate.changed != nil
	gate.mu.Unlock()
	if !initialized {
		return nil, ErrInvalidInput
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	registered := false
	for {
		gate.mu.Lock()
		if err := ctx.Err(); err != nil {
			if mutation && registered {
				gate.waitingMutations--
				gate.signalLocked()
			}
			gate.mu.Unlock()
			return nil, err
		}
		if mutation && !registered {
			gate.waitingMutations++
			registered = true
			gate.signalLocked()
		}
		if !gate.active && (mutation || gate.waitingMutations == 0) {
			gate.active = true
			if mutation {
				gate.waitingMutations--
			}
			gate.signalLocked()
			gate.mu.Unlock()
			var once sync.Once
			return func() {
				once.Do(func() {
					gate.mu.Lock()
					gate.active = false
					gate.signalLocked()
					gate.mu.Unlock()
				})
			}, nil
		}
		changed := gate.changed
		gate.mu.Unlock()

		select {
		case <-ctx.Done():
			if mutation && registered {
				gate.mu.Lock()
				gate.waitingMutations--
				gate.signalLocked()
				gate.mu.Unlock()
			}
			return nil, ctx.Err()
		case <-changed:
		}
	}
}

func (gate *ConsentAccessGate) signalLocked() {
	close(gate.changed)
	gate.changed = make(chan struct{})
}
