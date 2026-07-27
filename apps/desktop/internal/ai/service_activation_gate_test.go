package ai

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestCloseWindowCancelsBlockedPickerAndTombstonesWindow(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	release := make(chan struct{})
	authority := &blockingActivationAuthority{chooseEntered: make(chan session.WindowID, 1), chooseRelease: map[session.WindowID]chan struct{}{7: release}, selection: DirectorySelection{Approved: true, Path: "/trusted/root"}}
	service.native = authority
	result := make(chan error, 1)
	go func() { _, err := service.ChooseAndActivateWorkspace(gateContext(7)); result <- err }()
	<-authority.chooseEntered
	if err := CloseWindow(service, 7); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-result; !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("late picker=%v", err)
	}
	if containsCall(log.snapshot(), "validate") {
		t.Fatalf("downstream calls=%v", log.snapshot())
	}
	if _, err := service.ChooseAndActivateWorkspace(gateContext(7)); !errors.Is(err, ErrWindowUnavailable) || authority.calls() != 1 {
		t.Fatalf("reactivate=%v picker calls=%d", err, authority.calls())
	}
}

func TestCloseWindowRejectsLateQuestionAndRollsBackPendingAttach(t *testing.T) {
	log := &callLog{}
	service, _, attacher, _ := newGatedTestService(t, log)
	chooseRelease := make(chan struct{})
	close(chooseRelease)
	authority := &blockingActivationAuthority{chooseEntered: make(chan session.WindowID, 1), chooseRelease: map[session.WindowID]chan struct{}{7: chooseRelease}, selection: DirectorySelection{Approved: true, Path: "/trusted/root"}, questionEntered: make(chan struct{}), questionRelease: make(chan struct{})}
	service.native = authority
	attacher.decision = validDecision(workspaceid.AttachRenameConfirmationRequired)
	result := make(chan error, 1)
	go func() { _, err := service.ChooseAndActivateWorkspace(gateContext(7)); result <- err }()
	<-authority.questionEntered
	_ = CloseWindow(service, 7)
	close(authority.questionRelease)
	if err := <-result; !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("late question=%v", err)
	}
	calls := log.snapshot()
	if !containsCall(calls, "cancel-attach") || containsCall(calls, "confirm-attach") || containsCall(calls, "runtime") || containsCall(calls, "activate") {
		t.Fatalf("calls=%v", calls)
	}
}

func TestCloseBetweenRuntimeLoadAndActivateClosesRuntime(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	runtime := &runtimeSpy{}
	factory := &blockingRuntimeFactory{entered: make(chan struct{}), release: make(chan struct{}), runtime: runtime}
	service.runtimes = factory
	result := make(chan error, 1)
	go func() { _, err := service.ConfirmAndActivateWorkspace(gateContext(7), "/trusted/root"); result <- err }()
	<-factory.entered
	_ = CloseWindow(service, 7)
	close(factory.release)
	if err := <-result; !errors.Is(err, ErrWindowUnavailable) || runtime.closeCount() != 1 {
		t.Fatalf("err=%v closes=%d", err, runtime.closeCount())
	}
	if containsCall(log.snapshot(), "activate") {
		t.Fatalf("calls=%v", log.snapshot())
	}
}

func TestCloseBeforeLateActivationReturnsThenCleansNewSession(t *testing.T) {
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
		t.Fatal("close waited for activation commit")
	}
	close(registry.release)
	if err := <-activationResult; !errors.Is(err, ErrWindowUnavailable) || runtime.closeCount() != 1 {
		t.Fatalf("activation=%v closes=%d", err, runtime.closeCount())
	}
	_, deactivates := registry.snapshot()
	if deactivates != 1 {
		t.Fatalf("late activation rollbacks=%d", deactivates)
	}
}

func TestServiceCloseCancelsActivationAndRejectsEveryWindow(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	release := make(chan struct{})
	authority := &blockingActivationAuthority{chooseEntered: make(chan session.WindowID, 1), chooseRelease: map[session.WindowID]chan struct{}{7: release}, selection: DirectorySelection{Approved: true, Path: "/trusted/root"}}
	service.native = authority
	result := make(chan error, 1)
	go func() { _, err := service.ChooseAndActivateWorkspace(gateContext(7)); result <- err }()
	<-authority.chooseEntered
	if err := Close(service); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-result; !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("activation=%v", err)
	}
	if _, err := service.ChooseAndActivateWorkspace(gateContext(8)); !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("post-close=%v", err)
	}
}

func TestActivationGateRejectsSameWindowAndIsolatesDifferentWindows(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	releaseOne, releaseTwo := make(chan struct{}), make(chan struct{})
	authority := &blockingActivationAuthority{chooseEntered: make(chan session.WindowID, 3), chooseRelease: map[session.WindowID]chan struct{}{1: releaseOne, 2: releaseTwo}, selection: DirectorySelection{Approved: false}}
	service.native = authority
	results := make(chan error, 2)
	go func() { _, err := service.ChooseAndActivateWorkspace(gateContext(1)); results <- err }()
	<-authority.chooseEntered
	if _, err := service.ChooseAndActivateWorkspace(gateContext(1)); !errors.Is(err, ErrActivationBusy) || authority.calls() != 1 {
		t.Fatalf("same-window=%v calls=%d", err, authority.calls())
	}
	go func() { _, err := service.ChooseAndActivateWorkspace(gateContext(2)); results <- err }()
	if window := <-authority.chooseEntered; window != 2 {
		t.Fatalf("entered window=%d", window)
	}
	close(releaseOne)
	close(releaseTwo)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
}

func TestActivationLeaseCloseFinishRace(t *testing.T) {
	for range 100 {
		gate := newActivationGate()
		lease, err := gate.Acquire(context.Background(), 1)
		if err != nil {
			t.Fatal(err)
		}
		var wait sync.WaitGroup
		wait.Add(2)
		go func() { defer wait.Done(); lease.Finish() }()
		go func() { defer wait.Done(); gate.CloseWindow(1) }()
		wait.Wait()
		if lease.Context().Err() == nil {
			t.Fatal("lease context not cancelled")
		}
		if _, err := gate.Acquire(context.Background(), 1); !errors.Is(err, ErrWindowUnavailable) {
			t.Fatalf("reacquire=%v", err)
		}
	}
}

func containsCall(calls []string, wanted string) bool {
	for _, call := range calls {
		if call == wanted {
			return true
		}
	}
	return false
}
