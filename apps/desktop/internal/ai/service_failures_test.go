package ai

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestWorkspaceValidationFailureStopsBeforeAttach(t *testing.T) {
	for name, configure := range map[string]func(*validatorStub){
		"invalid shape": func(validator *validatorStub) { validator.result.Valid = false },
		"read error":    func(validator *validatorStub) { validator.err = errStub },
	} {
		t.Run(name, func(t *testing.T) {
			log := &callLog{}
			service, _, validator, _, _, _ := newTestService(log)
			configure(validator)
			_, err := service.ChooseAndActivateWorkspace(context.Background())
			if !errors.Is(err, ErrInvalidWorkspace) || strings.Contains(err.Error(), "/private") {
				t.Fatalf("err=%v", err)
			}
			want := []string{"window", "choose", "validate"}
			if got := log.snapshot(); !reflect.DeepEqual(got, want) {
				t.Fatalf("calls=%v", got)
			}
		})
	}
}

func TestBeginAttachFailureStopsBeforeConfirmation(t *testing.T) {
	log := &callLog{}
	service, _, _, attacher, _, _ := newTestService(log)
	attacher.beginErr = errStub
	_, err := service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrWorkspaceAttach) || strings.Contains(err.Error(), "/private") {
		t.Fatalf("err=%v", err)
	}
	want := []string{"window", "choose", "validate", "begin-attach"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestDecisionPromptFailureCancelsPendingAttach(t *testing.T) {
	log := &callLog{}
	service, authority, _, attacher, _, _ := newTestService(log)
	attacher.decision = validDecision(workspaceid.AttachRenameConfirmationRequired)
	authority.attachPromptErr = errStub
	_, err := service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrNativeAuthority) || strings.Contains(err.Error(), "/private") {
		t.Fatalf("err=%v", err)
	}
	want := []string{"window", "choose", "validate", "begin-attach", "confirm-decision", "cancel-attach"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestConfirmAttachFailureDoesNotLoadRuntimeOrActivate(t *testing.T) {
	log := &callLog{}
	service, _, _, attacher, _, _ := newTestService(log)
	attacher.confirmErr = errStub
	_, err := service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrWorkspaceAttach) || strings.Contains(err.Error(), "/private") {
		t.Fatalf("err=%v", err)
	}
	want := []string{"window", "choose", "validate", "begin-attach", "confirm-attach"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestRuntimeFailureClosesPartialRuntimeAndPreservesSession(t *testing.T) {
	log := &callLog{}
	service, _, _, _, factory, _ := newTestService(log)
	runtime := &runtimeSpy{}
	factory.runtime, factory.err = runtime, errStub
	_, err := service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrRuntimeLoad) || runtime.closeCount() != 1 {
		t.Fatalf("err=%v closes=%d", err, runtime.closeCount())
	}
	want := []string{"window", "choose", "validate", "begin-attach", "confirm-attach", "runtime"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestActivationFailureClosesRuntimeExactlyOnce(t *testing.T) {
	log := &callLog{}
	service, _, _, _, factory, registry := newTestService(log)
	runtime := &runtimeSpy{}
	factory.runtime = runtime
	registry.activateErr = errStub
	_, err := service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrActivation) || runtime.closeCount() != 1 || strings.Contains(err.Error(), "/private") {
		t.Fatalf("err=%v closes=%d", err, runtime.closeCount())
	}
	want := []string{"window", "choose", "validate", "begin-attach", "confirm-attach", "runtime", "activate"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestRealRegistryActivationFailurePreservesPriorCapability(t *testing.T) {
	registry := session.NewRegistry(session.Options{Random: bytes.NewReader(make([]byte, 32))})
	oldRuntime := &runtimeSpy{}
	old, err := registry.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "Old workspace"}, oldRuntime)
	if err != nil {
		t.Fatal(err)
	}
	log := &callLog{}
	service, _, _, _, factory, _ := newTestService(log)
	newRuntime := &runtimeSpy{}
	factory.runtime = newRuntime
	service.sessions = registry
	_, err = service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrActivation) || newRuntime.closeCount() != 1 || oldRuntime.closeCount() != 0 {
		t.Fatalf("err=%v new=%d old=%d", err, newRuntime.closeCount(), oldRuntime.closeCount())
	}
	lease, resolveErr := registry.Resolve(7, old.Reference())
	if resolveErr != nil {
		t.Fatalf("prior capability lost: %v", resolveErr)
	}
	lease.Finish()
}

func TestUnsafeCanonicalBasenameStopsBeforeRuntime(t *testing.T) {
	log := &callLog{}
	service, _, _, attacher, _, _ := newTestService(log)
	attacher.decision.CanonicalPath = "/safe/bad\u202Ename"
	_, err := service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrWorkspaceAttach) {
		t.Fatalf("err=%v", err)
	}
	want := []string{"window", "choose", "validate", "begin-attach", "cancel-attach"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestNewServiceRejectsMissingDependencies(t *testing.T) {
	if _, err := NewService(Dependencies{}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("err=%v", err)
	}
}

func TestNewServiceRejectsTypedNilFacadeDependencies(t *testing.T) {
	log := &callLog{}
	settingsStore, credentials := defaultFacadeRepositories()
	var typedNilSettings *settingsRepositoryStub
	dependencies := Dependencies{Windows: &windowResolverStub{log: log, window: 7}, Native: &nativeAuthorityStub{log: log},
		Validator: &validatorStub{log: log}, Attacher: &attacherStub{log: log}, Runtimes: &runtimeFactoryStub{log: log, runtime: &runtimeSpy{}},
		Sessions: &registryStub{log: log}, Streams: streamSinkFactoryStub{}, Settings: typedNilSettings, Credentials: credentials}
	if _, err := NewService(dependencies); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("settings err=%v", err)
	}
	dependencies.Settings = settingsStore
	var typedNilCredentials *credentialRepositoryStub
	dependencies.Credentials = typedNilCredentials
	if _, err := NewService(dependencies); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("credentials err=%v", err)
	}
}
