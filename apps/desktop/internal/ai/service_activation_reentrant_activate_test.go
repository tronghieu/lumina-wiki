package ai

import (
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestActivateReplacementCleanupMayReenterServiceClose(t *testing.T) {
	for name, callback := range map[string]func(*Service) error{
		"window close":  func(service *Service) error { return CloseWindow(service, 7) },
		"service close": Close,
	} {
		t.Run(name, func(t *testing.T) {
			log := &callLog{}
			service, _, _, _ := newGatedTestService(t, log)
			inner := session.NewRegistry(session.Options{})
			release := make(chan struct{})
			close(release)
			registry := &blockingSessionRegistry{inner: inner, entered: make(chan struct{}), release: release}
			service.sessions = registry
			oldRuntime := &reentrantCleanupRuntime{}
			oldRuntime.callback = func() error { return callback(service) }
			if _, err := inner.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "Old"}, oldRuntime); err != nil {
				t.Fatal(err)
			}
			newRuntime := &runtimeSpy{}
			service.runtimes = &runtimeFactoryStub{log: log, runtime: newRuntime}
			result := make(chan error, 1)
			go func() { _, err := service.ConfirmAndActivateWorkspace(gateContext(7), "/trusted/root"); result <- err }()
			select {
			case err := <-result:
				if !errors.Is(err, ErrWindowUnavailable) {
					t.Fatalf("activation=%v", err)
				}
			case <-time.After(500 * time.Millisecond):
				t.Fatal("Activate deadlocked in replacement cleanup")
			}
			capability, deactivates := registry.snapshot()
			if oldRuntime.closes.Load() != 1 || newRuntime.closeCount() != 1 || deactivates != 1 {
				t.Fatalf("old=%d new=%d deactivates=%d", oldRuntime.closes.Load(), newRuntime.closeCount(), deactivates)
			}
			if _, err := inner.Resolve(7, capability.Reference()); !errors.Is(err, session.ErrInvalidSession) {
				t.Fatalf("new capability remains: %v", err)
			}
		})
	}
}

type reentrantActivationErrorRegistry struct {
	oldRuntime *reentrantCleanupRuntime
}

func (registry *reentrantActivationErrorRegistry) Activate(_ session.WindowID, _ workspaceid.WorkspaceID, _ session.DisplayMetadata, runtime session.Runtime) (session.Capability, error) {
	_ = registry.oldRuntime.Close()
	_ = runtime.Close()
	return session.Capability{}, session.ErrSessionEntropy
}

func (*reentrantActivationErrorRegistry) Deactivate(session.WindowID, session.Reference) error {
	return session.ErrInvalidSession
}
func (*reentrantActivationErrorRegistry) CancelRequest(session.WindowID, session.Reference, string) error {
	return nil
}
func (*reentrantActivationErrorRegistry) CloseWindow(session.WindowID) error { return nil }
func (*reentrantActivationErrorRegistry) Close() error                       { return nil }

func TestActivateErrorCleanupMayReenterWindowCloseWithoutDoubleRuntimeClose(t *testing.T) {
	log := &callLog{}
	service, _, _, _ := newGatedTestService(t, log)
	oldRuntime := &reentrantCleanupRuntime{}
	oldRuntime.callback = func() error { return CloseWindow(service, 7) }
	service.sessions = &reentrantActivationErrorRegistry{oldRuntime: oldRuntime}
	newRuntime := &runtimeSpy{}
	service.runtimes = &runtimeFactoryStub{log: log, runtime: newRuntime}
	result := make(chan error, 1)
	go func() { _, err := service.ConfirmAndActivateWorkspace(gateContext(7), "/trusted/root"); result <- err }()
	select {
	case err := <-result:
		if !errors.Is(err, ErrWindowUnavailable) {
			t.Fatalf("activation=%v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Activate error cleanup deadlocked")
	}
	if oldRuntime.closes.Load() != 1 || newRuntime.closeCount() != 1 {
		t.Fatalf("old=%d new=%d", oldRuntime.closes.Load(), newRuntime.closeCount())
	}
}

var _ SessionRegistry = (*reentrantActivationErrorRegistry)(nil)
