package ai

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

func TestDeactivateDerivesWindowAndRejectsCrossWindow(t *testing.T) {
	registry := session.NewRegistry(session.Options{})
	runtime := &runtimeSpy{}
	capability, err := registry.Activate(1, testWorkspaceID, session.DisplayMetadata{Label: "Workspace"}, runtime)
	if err != nil {
		t.Fatal(err)
	}
	log := &callLog{}
	service, _, _, _, _, _ := newTestService(log)
	service.sessions = registry
	service.windows = &windowResolverStub{log: log, window: 2}
	reference := SessionReferenceDTO{SessionID: capability.SessionID, Generation: capability.Generation}
	if err := service.DeactivateWorkspace(context.Background(), reference); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("cross-window err=%v", err)
	}
	if runtime.closeCount() != 0 {
		t.Fatalf("cross-window closed runtime=%d", runtime.closeCount())
	}
	service.windows = &windowResolverStub{log: log, window: 1}
	if err := service.DeactivateWorkspace(context.Background(), reference); err != nil || runtime.closeCount() != 1 {
		t.Fatalf("deactivate=%v closes=%d", err, runtime.closeCount())
	}
}

func TestCancelChatRejectsForgedCapabilityBeforeRequestInspection(t *testing.T) {
	registry := session.NewRegistry(session.Options{})
	capability, err := registry.Activate(1, testWorkspaceID, session.DisplayMetadata{Label: "Workspace"}, &runtimeSpy{})
	if err != nil {
		t.Fatal(err)
	}
	requestContext, lease, err := registry.BeginRequest(context.Background(), 1, capability.Reference(), "request")
	if err != nil {
		t.Fatal(err)
	}
	log := &callLog{}
	service, _, _, _, _, _ := newTestService(log)
	service.sessions = registry
	service.windows = &windowResolverStub{log: log, window: 1}
	forged := SessionReferenceDTO{SessionID: capability.SessionID, Generation: capability.Generation + 1}
	if err := service.CancelChat(context.Background(), forged, "request"); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("forged err=%v", err)
	}
	if requestContext.Err() != nil {
		t.Fatal("forged capability touched request")
	}
	reference := SessionReferenceDTO{SessionID: capability.SessionID, Generation: capability.Generation}
	if err := service.CancelChat(context.Background(), reference, "missing"); err != nil {
		t.Fatalf("absent request=%v", err)
	}
	if err := service.CancelChat(context.Background(), reference, "request"); err != nil || requestContext.Err() != context.Canceled {
		t.Fatalf("cancel=%v context=%v", err, requestContext.Err())
	}
	lease.Finish()
}

func TestCancelChatAndFinishRace(t *testing.T) {
	for run := 0; run < 100; run++ {
		registry := session.NewRegistry(session.Options{})
		capability, _ := registry.Activate(1, testWorkspaceID, session.DisplayMetadata{Label: "Workspace"}, &runtimeSpy{})
		_, lease, _ := registry.BeginRequest(context.Background(), 1, capability.Reference(), "request")
		log := &callLog{}
		service, _, _, _, _, _ := newTestService(log)
		service.sessions = registry
		service.windows = &windowResolverStub{log: log, window: 1}
		reference := SessionReferenceDTO{SessionID: capability.SessionID, Generation: capability.Generation}
		var wait sync.WaitGroup
		wait.Add(2)
		go func() { defer wait.Done(); _ = service.CancelChat(context.Background(), reference, "request") }()
		go func() { defer wait.Done(); lease.Finish() }()
		wait.Wait()
	}
}

func TestWindowAndServiceShutdownArePackageFunctionsOnly(t *testing.T) {
	log := &callLog{}
	service, _, _, _, _, _ := newTestService(log)
	if err := CloseWindow(service, 7); err != nil {
		t.Fatal(err)
	}
	if err := Close(service); err != nil {
		t.Fatal(err)
	}
	if got := log.snapshot(); !reflect.DeepEqual(got, []string{"close-window", "close"}) {
		t.Fatalf("calls=%v", got)
	}
	typeOfService := reflect.TypeOf(service)
	for _, name := range []string{"CloseWindow", "Close"} {
		if _, exists := typeOfService.MethodByName(name); exists {
			t.Fatalf("%s must not be a bound method", name)
		}
	}
}
