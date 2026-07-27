package session

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

var testWorkspaceID = workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef")

type runtimeSpy struct {
	mu     sync.Mutex
	closes int
	err    error
}

func (runtime *runtimeSpy) Close() error {
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	runtime.closes++
	return runtime.err
}
func (runtime *runtimeSpy) closeCount() int {
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.closes
}

func entropy(values ...byte) *bytes.Reader {
	raw := make([]byte, 0, len(values)*32)
	for _, value := range values {
		raw = append(raw, bytes.Repeat([]byte{value}, 32)...)
	}
	return bytes.NewReader(raw)
}

func activate(t *testing.T, registry *Registry, window WindowID, runtime Runtime) Capability {
	t.Helper()
	capability, err := registry.Activate(window, testWorkspaceID, DisplayMetadata{Label: "Workspace"}, runtime)
	if err != nil {
		t.Fatal(err)
	}
	return capability
}

func TestCapabilityRejectsForgedStaleAndCrossWindow(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	first := activate(t, registry, 1, &runtimeSpy{})
	for name, tc := range map[string]struct {
		window WindowID
		ref    Reference
	}{
		"forged": {1, Reference{SessionID: SessionID("sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), Generation: first.Generation}},
		"cross":  {2, first.Reference()},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := registry.Resolve(tc.window, tc.ref); !errors.Is(err, ErrInvalidSession) {
				t.Fatalf("err=%v", err)
			}
		})
	}
	second := activate(t, registry, 1, &runtimeSpy{})
	if second.Generation <= first.Generation {
		t.Fatalf("generations: %d %d", first.Generation, second.Generation)
	}
	if _, err := registry.Resolve(1, first.Reference()); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("stale=%v", err)
	}
	lease, err := registry.Resolve(1, second.Reference())
	if err != nil || lease.Runtime() == nil {
		t.Fatalf("lease=%#v err=%v", lease, err)
	}
	lease.Finish()
}

func TestActivationReplacementCancelsThenDefersCloseUntilLeaseFinishes(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	oldRuntime, nextRuntime := &runtimeSpy{}, &runtimeSpy{}
	old := activate(t, registry, 1, oldRuntime)
	requestCtx, request, err := registry.BeginRequest(context.Background(), 1, old.Reference(), "request")
	if err != nil {
		t.Fatal(err)
	}
	next := activate(t, registry, 1, nextRuntime)
	if requestCtx.Err() != context.Canceled || oldRuntime.closeCount() != 0 {
		t.Fatalf("cancel=%v closes=%d", requestCtx.Err(), oldRuntime.closeCount())
	}
	if _, err := registry.Resolve(1, next.Reference()); err != nil {
		t.Fatal(err)
	}
	request.Finish()
	request.Finish()
	if oldRuntime.closeCount() != 1 || nextRuntime.closeCount() != 0 {
		t.Fatalf("old=%d next=%d", oldRuntime.closeCount(), nextRuntime.closeCount())
	}
}

func TestActivationRetriesCollisionAndRollsBackEntropyFailure(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(0, 0, 1)})
	first := activate(t, registry, 1, &runtimeSpy{})
	second := activate(t, registry, 1, &runtimeSpy{})
	if first.SessionID == second.SessionID {
		t.Fatal("session ID collision accepted")
	}
	failing := NewRegistry(Options{Random: bytes.NewReader(nil)})
	runtime := &runtimeSpy{}
	if _, err := failing.Activate(1, testWorkspaceID, DisplayMetadata{Label: "Workspace"}, runtime); !errors.Is(err, ErrSessionEntropy) {
		t.Fatalf("err=%v", err)
	}
	if runtime.closeCount() != 1 {
		t.Fatalf("rollback closes=%d", runtime.closeCount())
	}
}

func TestDeactivateWindowAndCloseCleanResources(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2, 3)})
	one, two, three := &runtimeSpy{}, &runtimeSpy{}, &runtimeSpy{err: errors.New("raw close")}
	capOne := activate(t, registry, 1, one)
	_ = activate(t, registry, 2, two)
	if err := registry.Deactivate(2, capOne.Reference()); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("cross deactivate=%v", err)
	}
	if err := registry.Deactivate(1, capOne.Reference()); err != nil || one.closeCount() != 1 {
		t.Fatalf("deactivate=%v closes=%d", err, one.closeCount())
	}
	registry.CloseWindow(2)
	if two.closeCount() != 1 {
		t.Fatalf("window close=%d", two.closeCount())
	}
	_ = activate(t, registry, 3, three)
	if err := registry.Close(); !errors.Is(err, ErrRuntimeClose) || three.closeCount() != 1 {
		t.Fatalf("close=%v count=%d", err, three.closeCount())
	}
}
