package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

func TestInvalidRollbackWithoutMatchingTombstoneIsCleanupFailure(t *testing.T) {
	for name, closeUnrelated := range map[string]bool{"gate open": false, "unrelated window tombstoned": true} {
		t.Run(name, func(t *testing.T) {
			log := &callLog{}
			service, _, _, _ := newGatedTestService(t, log)
			runtime := &runtimeSpy{}
			service.runtimes = &runtimeFactoryStub{log: log, runtime: runtime}
			registry := &blockingSessionRegistry{
				inner: session.NewRegistry(session.Options{}), entered: make(chan struct{}), release: make(chan struct{}),
				deactivateErr: session.ErrInvalidSession,
			}
			service.sessions = registry
			parent, cancel := context.WithCancel(gateContext(7))
			result := make(chan error, 1)
			go func() { _, err := service.ConfirmAndActivateWorkspace(parent, "/trusted/root"); result <- err }()
			<-registry.entered
			cancel()
			if closeUnrelated {
				if err := CloseWindow(service, 8); err != nil {
					t.Fatal(err)
				}
			}
			close(registry.release)
			if err := <-result; !errors.Is(err, ErrSessionCleanup) {
				t.Fatalf("activation=%v", err)
			}
			capability, deactivates := registry.snapshot()
			if deactivates != 1 || runtime.closeCount() != 0 {
				t.Fatalf("deactivates=%d closes=%d", deactivates, runtime.closeCount())
			}
			lease, err := registry.inner.Resolve(7, capability.Reference())
			if err != nil {
				t.Fatalf("faulty registry did not leave capability for negative proof: %v", err)
			}
			lease.Finish()
			_ = CloseWindow(service, 7)
		})
	}
}

func TestInvalidRollbackAfterServiceTombstoneIsIdempotentSuccess(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	runtime := &runtimeSpy{}
	service.runtimes = &runtimeFactoryStub{log: log, runtime: runtime}
	registry := &blockingSessionRegistry{
		inner: session.NewRegistry(session.Options{}), entered: make(chan struct{}), release: make(chan struct{}),
		deactivateEntered: make(chan struct{}), deactivateRelease: make(chan struct{}), deactivateErr: session.ErrInvalidSession,
	}
	service.sessions = registry
	parent, cancel := context.WithCancel(gateContext(7))
	result := make(chan error, 1)
	go func() { _, err := service.ConfirmAndActivateWorkspace(parent, "/trusted/root"); result <- err }()
	<-registry.entered
	cancel()
	close(registry.release)
	<-registry.deactivateEntered
	if err := Close(service); err != nil {
		t.Fatal(err)
	}
	close(registry.deactivateRelease)
	if err := <-result; !errors.Is(err, ErrActivation) {
		t.Fatalf("activation=%v", err)
	}
	capability, deactivates := registry.snapshot()
	if deactivates != 1 || runtime.closeCount() != 1 {
		t.Fatalf("deactivates=%d closes=%d", deactivates, runtime.closeCount())
	}
	if _, err := registry.inner.Resolve(7, capability.Reference()); !errors.Is(err, session.ErrInvalidSession) {
		t.Fatalf("capability remains: %v", err)
	}
}
