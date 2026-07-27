package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

func TestCallerCancellationDuringSuccessfulActivateRollsBackCapability(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	runtime := &runtimeSpy{}
	service.runtimes = &runtimeFactoryStub{log: log, runtime: runtime}
	registry := &blockingSessionRegistry{inner: session.NewRegistry(session.Options{}), entered: make(chan struct{}), release: make(chan struct{})}
	service.sessions = registry
	parent, cancel := context.WithCancel(gateContext(7))
	result := make(chan error, 1)
	go func() { _, err := service.ConfirmAndActivateWorkspace(parent, "/trusted/root"); result <- err }()
	<-registry.entered
	cancel()
	close(registry.release)
	if err := <-result; !errors.Is(err, ErrActivation) {
		t.Fatalf("activation=%v", err)
	}
	capability, deactivates := registry.snapshot()
	if deactivates != 1 || runtime.closeCount() != 1 {
		t.Fatalf("deactivates=%d closes=%d", deactivates, runtime.closeCount())
	}
	if _, err := registry.inner.Resolve(7, capability.Reference()); !errors.Is(err, session.ErrInvalidSession) {
		t.Fatalf("installed capability remains reachable: %v", err)
	}
}

func TestCallerCancellationRollbackCloseFailureIsSessionCleanup(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	runtime := &failingCloseRuntime{}
	service.runtimes = &runtimeFactoryStub{log: log, runtime: runtime}
	registry := &blockingSessionRegistry{inner: session.NewRegistry(session.Options{}), entered: make(chan struct{}), release: make(chan struct{})}
	service.sessions = registry
	parent, cancel := context.WithCancel(gateContext(7))
	result := make(chan error, 1)
	go func() { _, err := service.ConfirmAndActivateWorkspace(parent, "/trusted/root"); result <- err }()
	<-registry.entered
	cancel()
	close(registry.release)
	if err := <-result; !errors.Is(err, ErrSessionCleanup) || errors.Is(err, errStub) {
		t.Fatalf("activation=%v", err)
	}
	capability, deactivates := registry.snapshot()
	if deactivates != 1 || runtime.closes.Load() != 1 {
		t.Fatalf("deactivates=%d closes=%d", deactivates, runtime.closes.Load())
	}
	if _, err := registry.inner.Resolve(7, capability.Reference()); !errors.Is(err, session.ErrInvalidSession) {
		t.Fatalf("capability remains reachable: %v", err)
	}
}

func TestWindowCloseBeforeInstallTriggersLateRollback(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	runtime := &runtimeSpy{}
	service.runtimes = &runtimeFactoryStub{log: log, runtime: runtime}
	registry := &blockingSessionRegistry{inner: session.NewRegistry(session.Options{}), entered: make(chan struct{}), release: make(chan struct{})}
	service.sessions = registry
	activationResult := make(chan error, 1)
	go func() {
		_, err := service.ConfirmAndActivateWorkspace(gateContext(7), "/trusted/root")
		activationResult <- err
	}()
	<-registry.entered
	closeResult := make(chan error, 1)
	go func() { closeResult <- CloseWindow(service, 7) }()
	waitForGateTombstone(service.activations, 7)
	select {
	case err := <-closeResult:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(500 * time.Millisecond):
		close(registry.release)
		<-closeResult
		<-activationResult
		t.Fatal("window close waited for activation")
	}
	close(registry.release)
	if err := <-activationResult; !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("activation=%v", err)
	}
	_, deactivates := registry.snapshot()
	if deactivates != 1 || runtime.closeCount() != 1 {
		t.Fatalf("deactivates=%d closes=%d", deactivates, runtime.closeCount())
	}
}

func TestSuccessfulActivateWithoutCancellationReturnsCapability(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	runtime := &runtimeSpy{}
	service.runtimes = &runtimeFactoryStub{log: log, runtime: runtime}
	release := make(chan struct{})
	close(release)
	registry := &blockingSessionRegistry{inner: session.NewRegistry(session.Options{}), entered: make(chan struct{}), release: release}
	service.sessions = registry
	result, err := service.ConfirmAndActivateWorkspace(gateContext(7), "/trusted/root")
	if err != nil || result.Capability == nil {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	_, deactivates := registry.snapshot()
	if deactivates != 0 || runtime.closeCount() != 0 {
		t.Fatalf("deactivates=%d closes=%d", deactivates, runtime.closeCount())
	}
	_ = CloseWindow(service, 7)
}
