package session

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestBeginRequestDuplicateCancelAndFinishAreScoped(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	one := activate(t, registry, 1, &runtimeSpy{})
	two := activate(t, registry, 2, &runtimeSpy{})
	ctxOne, leaseOne, err := registry.BeginRequest(context.Background(), 1, one.Reference(), "same")
	if err != nil {
		t.Fatal(err)
	}
	ctxTwo, leaseTwo, err := registry.BeginRequest(context.Background(), 2, two.Reference(), "same")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := registry.BeginRequest(context.Background(), 1, one.Reference(), "same"); !errors.Is(err, ErrRequestActive) {
		t.Fatalf("duplicate=%v", err)
	}
	if err := registry.CancelRequest(1, one.Reference(), "same"); err != nil {
		t.Fatal(err)
	}
	if err := registry.CancelRequest(1, one.Reference(), "same"); err != nil {
		t.Fatal(err)
	}
	if ctxOne.Err() != context.Canceled || ctxTwo.Err() != nil {
		t.Fatalf("one=%v two=%v", ctxOne.Err(), ctxTwo.Err())
	}
	leaseOne.Finish()
	if err := registry.CancelRequest(1, one.Reference(), "same"); err != nil {
		t.Fatalf("terminal cancel=%v", err)
	}
	leaseTwo.Finish()
}

func TestCancelValidatesCapabilityBeforeRequestLookup(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	first := activate(t, registry, 1, &runtimeSpy{})
	ctx, lease, _ := registry.BeginRequest(context.Background(), 1, first.Reference(), "request")
	for _, tc := range []struct {
		window WindowID
		ref    Reference
	}{{2, first.Reference()}, {1, Reference{SessionID: first.SessionID, Generation: first.Generation + 1}}} {
		if err := registry.CancelRequest(tc.window, tc.ref, "request"); !errors.Is(err, ErrInvalidSession) {
			t.Fatalf("err=%v", err)
		}
		if ctx.Err() != nil {
			t.Fatal("invalid cancel touched request")
		}
	}
	if err := registry.CancelRequest(2, first.Reference(), ""); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("capability was not validated first: %v", err)
	}
	lease.Finish()
}

func TestStaleFinishCannotRemoveNewRequest(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1)})
	capability := activate(t, registry, 1, &runtimeSpy{})
	_, first, _ := registry.BeginRequest(context.Background(), 1, capability.Reference(), "request")
	first.Finish()
	newCtx, second, err := registry.BeginRequest(context.Background(), 1, capability.Reference(), "request")
	if err != nil {
		t.Fatal(err)
	}
	first.Finish()
	_ = registry.CancelRequest(1, capability.Reference(), "request")
	if newCtx.Err() != context.Canceled {
		t.Fatalf("new request not cancelled: %v", newCtx.Err())
	}
	second.Finish()
}

func TestCancelFinishRaceAndDeactivateDuringRequest(t *testing.T) {
	for run := 0; run < 100; run++ {
		registry := NewRegistry(Options{Random: entropy(byte(run + 1))})
		runtime := &runtimeSpy{}
		capability := activate(t, registry, 1, runtime)
		ctx, lease, _ := registry.BeginRequest(context.Background(), 1, capability.Reference(), "request")
		var wait sync.WaitGroup
		wait.Add(2)
		go func() { defer wait.Done(); _ = registry.CancelRequest(1, capability.Reference(), "request") }()
		go func() { defer wait.Done(); lease.Finish() }()
		wait.Wait()
		_ = ctx.Err()
		if err := registry.Deactivate(1, capability.Reference()); err != nil {
			t.Fatal(err)
		}
		lease.Finish()
		if runtime.closeCount() != 1 {
			t.Fatalf("run=%d closes=%d", run, runtime.closeCount())
		}
	}
}

func TestDeactivateAndCloseWindowCancelBeforeDeferredClose(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	oneRuntime, twoRuntime := &runtimeSpy{}, &runtimeSpy{}
	one := activate(t, registry, 1, oneRuntime)
	two := activate(t, registry, 2, twoRuntime)
	oneCtx, oneLease, _ := registry.BeginRequest(context.Background(), 1, one.Reference(), "one")
	twoCtx, twoLease, _ := registry.BeginRequest(context.Background(), 2, two.Reference(), "two")
	if err := registry.Deactivate(1, one.Reference()); err != nil {
		t.Fatal(err)
	}
	registry.CloseWindow(2)
	if oneCtx.Err() != context.Canceled || twoCtx.Err() != context.Canceled || oneRuntime.closeCount() != 0 || twoRuntime.closeCount() != 0 {
		t.Fatalf("ctx=%v/%v close=%d/%d", oneCtx.Err(), twoCtx.Err(), oneRuntime.closeCount(), twoRuntime.closeCount())
	}
	oneLease.Finish()
	twoLease.Finish()
	if oneRuntime.closeCount() != 1 || twoRuntime.closeCount() != 1 {
		t.Fatalf("close=%d/%d", oneRuntime.closeCount(), twoRuntime.closeCount())
	}
}
