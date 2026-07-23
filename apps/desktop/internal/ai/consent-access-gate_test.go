package ai

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestConsentAccessGateSerializesUseAndMutation(t *testing.T) {
	gate := NewConsentAccessGate()
	finishMutation, err := gate.BeginMutation(context.Background())
	if err != nil {
		t.Fatalf("begin mutation: %v", err)
	}

	waitCtx, cancel := context.WithCancel(context.Background())
	waiter := make(chan error, 1)
	go func() {
		_, waitErr := gate.BeginUse(waitCtx)
		waiter <- waitErr
	}()
	select {
	case err := <-waiter:
		t.Fatalf("use did not wait for mutation: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	cancel()
	if err := <-waiter; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled waiter error = %v, want context.Canceled", err)
	}

	finishMutation()
	finishMutation()
	finishUse, err := gate.BeginUse(context.Background())
	if err != nil {
		t.Fatalf("begin use after release: %v", err)
	}
	finishUse()
}

func TestConsentAccessGateRejectsNilReceiversAndContexts(t *testing.T) {
	var gate *ConsentAccessGate
	if _, err := gate.BeginUse(context.Background()); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("nil gate error = %v, want ErrInvalidInput", err)
	}
	gate = NewConsentAccessGate()
	if _, err := gate.BeginMutation(nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("nil context error = %v, want ErrInvalidInput", err)
	}
}

func TestConsentAccessGateQueuesNewConsumersBehindWaitingMutation(t *testing.T) {
	gate := NewConsentAccessGate()
	finishActiveUse, err := gate.BeginUse(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	mutationAcquired := make(chan func(), 1)
	go func() {
		finish, acquireErr := gate.BeginMutation(context.Background())
		if acquireErr == nil {
			mutationAcquired <- finish
		}
	}()
	waitForWaitingConsentMutation(t, gate)
	consumerAcquired := make(chan func(), 1)
	go func() {
		finish, acquireErr := gate.BeginUse(context.Background())
		if acquireErr == nil {
			consumerAcquired <- finish
		}
	}()
	finishActiveUse()
	finishMutation := <-mutationAcquired
	select {
	case finish := <-consumerAcquired:
		finish()
		t.Fatal("new consumer bypassed waiting mutation")
	case <-time.After(10 * time.Millisecond):
	}
	finishMutation()
	finishConsumer := <-consumerAcquired
	finishConsumer()
}

func waitForWaitingConsentMutation(t *testing.T, gate *ConsentAccessGate) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		gate.mu.Lock()
		waiting := gate.waitingMutations
		gate.mu.Unlock()
		if waiting > 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("mutation did not enter the priority queue")
}
