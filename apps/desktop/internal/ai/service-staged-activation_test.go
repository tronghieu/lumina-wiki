package ai

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

type trustedValidatorStub struct {
	validatorStub
}

func (stub *trustedValidatorStub) ValidateTrusted(ctx context.Context, root string, proof rootproof.RootProof) (WorkspaceShape, error) {
	stub.log.add("validate-trusted")
	if ctx == nil || ctx.Err() != nil || proof.Path() != root || proof.Validate() != nil {
		return WorkspaceShape{}, ErrInvalidWorkspace
	}
	return stub.result, stub.err
}

type trustedRuntimeFactoryStub struct {
	runtimeFactoryStub
}

func (stub *trustedRuntimeFactoryStub) LoadTrusted(_ context.Context, id workspaceid.WorkspaceID,
	root string, proof os.FileInfo) (session.Runtime, error) {
	stub.log.add("runtime-trusted")
	stub.loadedID, stub.loadedRoot = id, root
	if proof == nil || !proof.IsDir() {
		return nil, ErrRuntimeLoad
	}
	return stub.runtime, stub.err
}

func TestStagedActivationAbortsIdentityAndPreservesPriorSessionOnRuntimeFailure(t *testing.T) {
	log := &callLog{}
	service, authority, _, _, _, _ := newTestService(log)
	root := makeWorkspaceRoot(t)
	authority.directoryOK = true

	manager, err := workspaceid.NewManager(t.TempDir(), workspaceid.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	registry := session.NewRegistry(session.Options{})
	defer registry.Close()
	priorRuntime := &runtimeSpy{}
	prior, err := registry.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "Prior"}, priorRuntime)
	if err != nil {
		t.Fatal(err)
	}
	service.validator = &trustedValidatorStub{validatorStub{log: log, result: WorkspaceShape{Valid: true}}}
	service.attacher = manager
	service.runtimes = &trustedRuntimeFactoryStub{runtimeFactoryStub{
		log: log, runtime: &runtimeSpy{}, err: errStub,
	}}
	service.sessions = registry

	_, err = service.ConfirmAndActivateWorkspace(context.Background(), root)
	if !errors.Is(err, ErrRuntimeLoad) {
		t.Fatalf("activation error = %v", err)
	}
	lease, err := registry.Resolve(7, prior.Reference())
	if err != nil {
		t.Fatalf("prior session was replaced: %v", err)
	}
	lease.Finish()
	decision, err := manager.BeginAttach(root)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.CancelAttach(decision.Token)
	if decision.Kind != workspaceid.AttachNew {
		t.Fatalf("failed activation persisted identity as %s", decision.Kind)
	}
}

func TestProductionCapableDependenciesUseTrustedStagedActivation(t *testing.T) {
	log := &callLog{}
	service, authority, _, _, _, _ := newTestService(log)
	root := makeWorkspaceRoot(t)
	authority.directoryOK = true

	manager, err := workspaceid.NewManager(t.TempDir(), workspaceid.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	registry := session.NewRegistry(session.Options{})
	defer registry.Close()
	runtime := &runtimeSpy{}
	service.validator = &trustedValidatorStub{validatorStub{log: log, result: WorkspaceShape{Valid: true}}}
	service.attacher = manager
	service.runtimes = &trustedRuntimeFactoryStub{runtimeFactoryStub{log: log, runtime: runtime}}
	service.sessions = registry

	result, err := service.ConfirmAndActivateWorkspace(context.Background(), root)
	if err != nil || result.Capability == nil {
		t.Fatalf("activation = %#v, %v", result, err)
	}
	lease, err := registry.Resolve(7, result.CapabilityReference())
	if err != nil {
		t.Fatal(err)
	}
	if lease.AccessMode() != session.AccessReadOnly {
		t.Fatalf("access mode = %s", lease.AccessMode())
	}
	lease.Finish()
	decision, err := manager.BeginAttach(root)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.CancelAttach(decision.Token)
	if decision.Kind != workspaceid.AttachKnown {
		t.Fatalf("successful staged activation identity = %s", decision.Kind)
	}
	calls := log.snapshot()
	if !stagedContainsCall(calls, "validate-trusted") || !stagedContainsCall(calls, "runtime-trusted") ||
		stagedContainsCall(calls, "validate") || stagedContainsCall(calls, "runtime") {
		t.Fatalf("activation calls = %v", calls)
	}
}

func makeWorkspaceRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	proof, err := rootproof.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	path := proof.Path()
	_ = proof.Close()
	return path
}

func (result ActivationResult) CapabilityReference() session.Reference {
	if result.Capability == nil {
		return session.Reference{}
	}
	return session.Reference{SessionID: result.Capability.SessionID, Generation: result.Capability.Generation}
}

func stagedContainsCall(calls []string, expected string) bool {
	for _, call := range calls {
		if call == expected {
			return true
		}
	}
	return false
}
