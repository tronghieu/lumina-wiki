package session

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestRejectsInvalidActivationAndRequestInputs(t *testing.T) {
	for name, tc := range map[string]struct {
		window    WindowID
		workspace workspaceid.WorkspaceID
		display   DisplayMetadata
	}{
		"window":    {0, testWorkspaceID, DisplayMetadata{Label: "Workspace"}},
		"workspace": {1, "bad", DisplayMetadata{Label: "Workspace"}},
		"display":   {1, testWorkspaceID, DisplayMetadata{}},
	} {
		t.Run(name, func(t *testing.T) {
			runtime := &runtimeSpy{}
			registry := NewRegistry(Options{Random: entropy(1)})
			if _, err := registry.Activate(tc.window, tc.workspace, tc.display, runtime); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("err=%v", err)
			}
			if runtime.closeCount() != 1 {
				t.Fatalf("rollback closes=%d", runtime.closeCount())
			}
		})
	}

	registry := NewRegistry(Options{Random: entropy(1)})
	capability := activate(t, registry, 1, &runtimeSpy{})
	if _, _, err := registry.BeginRequest(nil, 1, capability.Reference(), "request"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("nil context=%v", err)
	}
	for _, requestID := range []string{"", "has spaces", strings.Repeat("a", 65)} {
		if _, _, err := registry.BeginRequest(context.Background(), 1, capability.Reference(), requestID); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("request %q: %v", requestID, err)
		}
	}
	if err := registry.CancelRequest(1, capability.Reference(), "absent"); err != nil {
		t.Fatalf("absent request=%v", err)
	}
	var nilRuntime *runtimeSpy
	if _, err := registry.Activate(2, testWorkspaceID, DisplayMetadata{Label: "Workspace"}, nilRuntime); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("typed nil runtime=%v", err)
	}
}

func TestCapabilityDTOExcludesWindowAndCanonicalRoot(t *testing.T) {
	typeOfCapability := reflect.TypeOf(Capability{})
	for index := 0; index < typeOfCapability.NumField(); index++ {
		name := strings.ToLower(typeOfCapability.Field(index).Name)
		if strings.Contains(name, "window") || strings.Contains(name, "root") || strings.Contains(name, "path") {
			t.Fatalf("backend-only field leaked: %s", name)
		}
	}
}

func TestResolveLeaseDefersRuntimeClose(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1)})
	runtime := &runtimeSpy{}
	capability := activate(t, registry, 1, runtime)
	lease, err := registry.Resolve(1, capability.Reference())
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.Deactivate(1, capability.Reference()); err != nil || runtime.closeCount() != 0 {
		t.Fatalf("deactivate=%v closes=%d", err, runtime.closeCount())
	}
	lease.Finish()
	lease.Finish()
	if runtime.closeCount() != 1 {
		t.Fatalf("closes=%d", runtime.closeCount())
	}
}

type reentrantRuntime struct {
	registry *Registry
	done     chan struct{}
}

func (runtime *reentrantRuntime) Close() error {
	_ = runtime.registry.CloseWindow(99)
	close(runtime.done)
	return nil
}

func TestRuntimeCloseRunsOutsideRegistryLock(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1)})
	runtime := &reentrantRuntime{registry: registry, done: make(chan struct{})}
	capability := activate(t, registry, 1, runtime)
	go func() { _ = registry.Deactivate(1, capability.Reference()) }()
	select {
	case <-runtime.done:
	case <-time.After(time.Second):
		t.Fatal("runtime Close deadlocked on registry lock")
	}
}

func TestClosedRegistryRejectsActivationAndClosesIncomingRuntime(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1)})
	if err := registry.Close(); err != nil {
		t.Fatal(err)
	}
	runtime := &runtimeSpy{}
	if _, err := registry.Activate(1, testWorkspaceID, DisplayMetadata{Label: "Workspace"}, runtime); !errors.Is(err, ErrRegistryClosed) {
		t.Fatalf("err=%v", err)
	}
	if runtime.closeCount() != 1 {
		t.Fatalf("rollback closes=%d", runtime.closeCount())
	}
}

func TestConcurrentActivationsHaveUniqueMonotonicGenerations(t *testing.T) {
	const count = 64
	registry := NewRegistry(Options{})
	generations := make(chan Generation, count)
	runtimes := make([]*runtimeSpy, count)
	var wait sync.WaitGroup
	for index := range count {
		runtimes[index] = &runtimeSpy{}
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			capability, err := registry.Activate(WindowID(index+1), testWorkspaceID, DisplayMetadata{Label: "Workspace"}, runtimes[index])
			if err != nil {
				t.Errorf("activate: %v", err)
				return
			}
			generations <- capability.Generation
		}(index)
	}
	wait.Wait()
	close(generations)
	seen := make(map[Generation]struct{}, count)
	for generation := range generations {
		if generation == 0 {
			t.Fatal("zero generation")
		}
		seen[generation] = struct{}{}
	}
	if len(seen) != count {
		t.Fatalf("unique generations=%d", len(seen))
	}
	if err := registry.Close(); err != nil {
		t.Fatal(err)
	}
	for index, runtime := range runtimes {
		if runtime.closeCount() != 1 {
			t.Fatalf("runtime %d closes=%d", index, runtime.closeCount())
		}
	}
}
