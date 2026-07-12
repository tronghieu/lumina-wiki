package ai

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type reentrantCleanupRuntime struct {
	closes   atomic.Int32
	callback func() error
}

func (runtime *reentrantCleanupRuntime) Close() error {
	runtime.closes.Add(1)
	return runtime.callback()
}

func TestCancelledActivationRollbackAllowsReentrantServiceCleanup(t *testing.T) {
	for name, callback := range map[string]func(*Service) error{
		"window close":  func(service *Service) error { return CloseWindow(service, 7) },
		"service close": Close,
	} {
		t.Run(name, func(t *testing.T) {
			log := &callLog{}
			service, _, _, _ := newGatedTestService(t, log)
			runtime := &reentrantCleanupRuntime{}
			runtime.callback = func() error { return callback(service) }
			service.runtimes = &runtimeFactoryStub{log: log, runtime: runtime}
			registry := &blockingSessionRegistry{inner: session.NewRegistry(session.Options{}), entered: make(chan struct{}), release: make(chan struct{})}
			service.sessions = registry
			parent, cancel := context.WithCancel(gateContext(7))
			result := make(chan error, 1)
			go func() { _, err := service.ConfirmAndActivateWorkspace(parent, "/trusted/root"); result <- err }()
			<-registry.entered
			cancel()
			close(registry.release)
			select {
			case err := <-result:
				if !errors.Is(err, ErrActivation) {
					t.Fatalf("activation=%v", err)
				}
			case <-time.After(500 * time.Millisecond):
				t.Fatal("rollback deadlocked during reentrant cleanup")
			}
			capability, deactivates := registry.snapshot()
			if deactivates != 1 || runtime.closes.Load() != 1 {
				t.Fatalf("deactivates=%d closes=%d", deactivates, runtime.closes.Load())
			}
			if _, err := registry.inner.Resolve(7, capability.Reference()); !errors.Is(err, session.ErrInvalidSession) {
				t.Fatalf("capability remains: %v", err)
			}
		})
	}
}

func TestCancelledRollbackRacingExternalCloseIsIdempotent(t *testing.T) {
	for run := 0; run < 100; run++ {
		log := &callLog{}
		service, _, _, _ := newGatedTestService(t, log)
		runtime := &runtimeSpy{}
		service.runtimes = &runtimeFactoryStub{log: log, runtime: runtime}
		registry := &blockingSessionRegistry{
			inner: session.NewRegistry(session.Options{}), entered: make(chan struct{}), release: make(chan struct{}),
			deactivateEntered: make(chan struct{}), deactivateRelease: make(chan struct{}),
		}
		service.sessions = registry
		parent, cancel := context.WithCancel(gateContext(7))
		result := make(chan error, 1)
		go func() { _, err := service.ConfirmAndActivateWorkspace(parent, "/trusted/root"); result <- err }()
		<-registry.entered
		cancel()
		close(registry.release)
		<-registry.deactivateEntered
		closeResult := make(chan error, 1)
		go func() { closeResult <- CloseWindow(service, 7) }()
		select {
		case err := <-closeResult:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(500 * time.Millisecond):
			t.Fatal("external close waited on rollback cleanup")
		}
		close(registry.deactivateRelease)
		if err := <-result; !errors.Is(err, ErrActivation) {
			t.Fatalf("run=%d activation=%v", run, err)
		}
		capability, deactivates := registry.snapshot()
		if deactivates != 1 || runtime.closeCount() != 1 {
			t.Fatalf("run=%d deactivates=%d closes=%d", run, deactivates, runtime.closeCount())
		}
		if _, err := registry.inner.Resolve(7, capability.Reference()); !errors.Is(err, session.ErrInvalidSession) {
			t.Fatalf("run=%d capability remains: %v", run, err)
		}
	}
}
