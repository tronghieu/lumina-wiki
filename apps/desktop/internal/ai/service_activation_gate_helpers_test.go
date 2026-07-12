package ai

import (
	"context"
	"runtime"
	"sync"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

type gateWindowContextKey struct{}

type gateWindowResolver struct{}

func (gateWindowResolver) ResolveWindow(ctx context.Context) (session.WindowID, error) {
	window, _ := ctx.Value(gateWindowContextKey{}).(session.WindowID)
	if window == 0 {
		return 0, ErrWindowUnavailable
	}
	return window, nil
}

func gateContext(window session.WindowID) context.Context {
	return context.WithValue(context.Background(), gateWindowContextKey{}, window)
}

func waitForGateTombstone(gate *activationGate, window session.WindowID) {
	for {
		gate.mu.Lock()
		state := gate.windows[window]
		closed := state != nil && state.tombstoned
		gate.mu.Unlock()
		if closed {
			return
		}
		runtime.Gosched()
	}
}

type blockingActivationAuthority struct {
	mu              sync.Mutex
	chooseCalls     int
	chooseEntered   chan session.WindowID
	chooseRelease   map[session.WindowID]chan struct{}
	selection       DirectorySelection
	questionEntered chan struct{}
	questionRelease chan struct{}
}

func (authority *blockingActivationAuthority) ChooseDirectory(_ context.Context, window session.WindowID) (DirectorySelection, error) {
	authority.mu.Lock()
	authority.chooseCalls++
	authority.mu.Unlock()
	authority.chooseEntered <- window
	<-authority.chooseRelease[window]
	return authority.selection, nil
}

func (*blockingActivationAuthority) ConfirmDirectory(context.Context, session.WindowID, string) (bool, error) {
	return true, nil
}

func (authority *blockingActivationAuthority) ConfirmAttachDecision(context.Context, session.WindowID, workspaceid.AttachKind) (bool, error) {
	close(authority.questionEntered)
	<-authority.questionRelease
	return true, nil
}

func (authority *blockingActivationAuthority) calls() int {
	authority.mu.Lock()
	defer authority.mu.Unlock()
	return authority.chooseCalls
}

type blockingRuntimeFactory struct {
	entered chan struct{}
	release chan struct{}
	runtime session.Runtime
}

type blockingSessionRegistry struct {
	inner             *session.Registry
	entered           chan struct{}
	release           chan struct{}
	mu                sync.Mutex
	capability        session.Capability
	deactivates       int
	deactivateEntered chan struct{}
	deactivateRelease chan struct{}
	deactivateErr     error
}

func (registry *blockingSessionRegistry) Activate(window session.WindowID, id workspaceid.WorkspaceID, display session.DisplayMetadata, runtime session.Runtime) (session.Capability, error) {
	close(registry.entered)
	<-registry.release
	capability, err := registry.inner.Activate(window, id, display, runtime)
	registry.mu.Lock()
	registry.capability = capability
	registry.mu.Unlock()
	return capability, err
}

func (registry *blockingSessionRegistry) Deactivate(window session.WindowID, reference session.Reference) error {
	registry.mu.Lock()
	registry.deactivates++
	registry.mu.Unlock()
	if registry.deactivateEntered != nil {
		close(registry.deactivateEntered)
	}
	if registry.deactivateRelease != nil {
		<-registry.deactivateRelease
	}
	if registry.deactivateErr != nil {
		return registry.deactivateErr
	}
	return registry.inner.Deactivate(window, reference)
}

func (registry *blockingSessionRegistry) CancelRequest(window session.WindowID, reference session.Reference, requestID string) error {
	return registry.inner.CancelRequest(window, reference, requestID)
}

func (registry *blockingSessionRegistry) CloseWindow(window session.WindowID) error {
	return registry.inner.CloseWindow(window)
}

func (registry *blockingSessionRegistry) Close() error { return registry.inner.Close() }

func (registry *blockingSessionRegistry) snapshot() (session.Capability, int) {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	return registry.capability, registry.deactivates
}

func (factory *blockingRuntimeFactory) Load(context.Context, workspaceid.WorkspaceID, string) (session.Runtime, error) {
	close(factory.entered)
	<-factory.release
	return factory.runtime, nil
}

func newGatedTestService(t *testing.T, log *callLog) (*Service, *validatorStub, *attacherStub, *registryStub) {
	t.Helper()
	service, _, validator, attacher, _, registry := newTestService(log)
	service.windows = gateWindowResolver{}
	return service, validator, attacher, registry
}
