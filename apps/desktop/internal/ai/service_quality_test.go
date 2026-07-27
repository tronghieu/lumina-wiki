package ai

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestTypedControlCharacterRejectedBeforeWindowResolution(t *testing.T) {
	log := &callLog{}
	service, _, _, _, _, _ := newTestService(log)
	if _, err := service.ConfirmAndActivateWorkspace(context.Background(), "/safe/bad\nroot"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("err=%v", err)
	}
	if got := log.snapshot(); len(got) != 0 {
		t.Fatalf("calls=%v", got)
	}
}

func TestTypedNativeErrorStopsBeforeValidation(t *testing.T) {
	log := &callLog{}
	service, authority, _, _, _, _ := newTestService(log)
	authority.directoryErr = errStub
	if _, err := service.ConfirmAndActivateWorkspace(context.Background(), "/private/root"); !errors.Is(err, ErrNativeAuthority) {
		t.Fatalf("err=%v", err)
	}
	want := []string{"window", "confirm-directory"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestDecisionDenialCancelFailureIsAttemptedOnce(t *testing.T) {
	log := &callLog{}
	service, authority, _, attacher, _, _ := newTestService(log)
	attacher.decision = validDecision(workspaceid.AttachIdentityConfirmationRequired)
	authority.attachDecision = false
	attacher.cancelErr = errStub
	if _, err := service.ChooseAndActivateWorkspace(context.Background()); !errors.Is(err, ErrWorkspaceAttach) {
		t.Fatalf("err=%v", err)
	}
	want := []string{"window", "choose", "validate", "begin-attach", "confirm-decision", "cancel-attach"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestTypedNilRuntimeIsRejectedBeforeActivation(t *testing.T) {
	log := &callLog{}
	service, _, _, _, factory, _ := newTestService(log)
	var runtime *runtimeSpy
	factory.runtime = runtime
	if _, err := service.ChooseAndActivateWorkspace(context.Background()); !errors.Is(err, ErrRuntimeLoad) {
		t.Fatalf("err=%v", err)
	}
	want := []string{"window", "choose", "validate", "begin-attach", "confirm-attach", "runtime"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestRuntimeReceivesConfirmedIdentityAndCanonicalRoot(t *testing.T) {
	log := &callLog{}
	service, _, _, attacher, factory, registry := newTestService(log)
	attacher.decision.CanonicalPath = `C:\trusted\Nghiên cứu 🧭`
	result, err := service.ConfirmAndActivateWorkspace(context.Background(), "/untrusted/caller-text")
	if err != nil {
		t.Fatal(err)
	}
	if factory.loadedID != testWorkspaceID || factory.loadedRoot != attacher.decision.CanonicalPath {
		t.Fatalf("id=%q root=%q", factory.loadedID, factory.loadedRoot)
	}
	if registry.display.Label != "Nghiên cứu 🧭" || result.Capability == nil {
		t.Fatalf("activation display=%q", registry.display.Label)
	}
}

func TestUnknownAttachKindCancelsWithoutConfirmation(t *testing.T) {
	log := &callLog{}
	service, _, _, attacher, _, _ := newTestService(log)
	attacher.decision = validDecision(workspaceid.AttachKind("future-kind"))
	if _, err := service.ChooseAndActivateWorkspace(context.Background()); !errors.Is(err, ErrWorkspaceAttach) {
		t.Fatalf("err=%v", err)
	}
	want := []string{"window", "choose", "validate", "begin-attach", "cancel-attach"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
}

func TestFacadeResultContainsNoProviderOrAuthoritySecrets(t *testing.T) {
	typeOfCapability := reflect.TypeOf(CapabilityDTO{})
	for index := 0; index < typeOfCapability.NumField(); index++ {
		name := typeOfCapability.Field(index).Name
		for _, forbidden := range []string{"Root", "Path", "Window", "Token", "Provider", "Secret"} {
			if name == forbidden {
				t.Fatalf("unsafe field: %s", name)
			}
		}
	}
}

var _ session.Runtime = (*runtimeSpy)(nil)
