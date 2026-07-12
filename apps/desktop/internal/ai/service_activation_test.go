package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestChooseCancellationStopsBeforeWorkspaceAccess(t *testing.T) {
	log := &callLog{}
	service, authority, _, _, _, _ := newTestService(log)
	authority.selection = DirectorySelection{Approved: false, Path: "/private/cancelled"}
	result, err := service.ChooseAndActivateWorkspace(context.Background())
	if err != nil || result.Status != ActivationCancelled || result.Capability != nil {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if got := log.snapshot(); !reflect.DeepEqual(got, []string{"window", "choose"}) {
		t.Fatalf("calls=%v", got)
	}
}

func TestChooseErrorIsSafeAndStopsBeforeWorkspaceAccess(t *testing.T) {
	log := &callLog{}
	service, authority, _, _, _, _ := newTestService(log)
	authority.chooseErr = errStub
	result, err := service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrNativeAuthority) || strings.Contains(err.Error(), "/private") || result.Capability != nil {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if got := log.snapshot(); !reflect.DeepEqual(got, []string{"window", "choose"}) {
		t.Fatalf("calls=%v", got)
	}
}

func TestConfirmValidatesSyntaxBeforeWindowAndNativeAuthority(t *testing.T) {
	for _, root := range []string{"", strings.Repeat("x", MaxTypedRootBytes+1), "bad\x00root", string([]byte{0xff})} {
		log := &callLog{}
		service, _, _, _, _, _ := newTestService(log)
		result, err := service.ConfirmAndActivateWorkspace(context.Background(), root)
		if !errors.Is(err, ErrInvalidInput) || result.Capability != nil {
			t.Fatalf("root=%q result=%#v err=%v", root, result, err)
		}
		if len(log.snapshot()) != 0 || (root != "" && strings.Contains(err.Error(), root)) {
			t.Fatalf("calls=%v err=%v", log.snapshot(), err)
		}
	}
}

func TestTypedDirectoryDenialPreventsReadsAndPreservesSession(t *testing.T) {
	log := &callLog{}
	service, authority, _, _, _, _ := newTestService(log)
	authority.directoryOK = false
	result, err := service.ConfirmAndActivateWorkspace(context.Background(), "/private/typed-root")
	if err != nil || result.Status != ActivationCancelled || result.Capability != nil {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if got := log.snapshot(); !reflect.DeepEqual(got, []string{"window", "confirm-directory"}) {
		t.Fatalf("calls=%v", got)
	}
}

func TestApprovedKnownWorkspaceActivatesInTrustOrder(t *testing.T) {
	log := &callLog{}
	service, _, _, _, _, _ := newTestService(log)
	result, err := service.ConfirmAndActivateWorkspace(context.Background(), "/private/typed-root")
	if err != nil || result.Status != ActivationActive || result.Capability == nil {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	want := []string{"window", "confirm-directory", "validate", "begin-attach", "confirm-attach", "runtime", "activate"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls=%v", got)
	}
	raw, _ := json.Marshal(result)
	serialized := string(raw)
	for _, secret := range []string{"/private/typed-root", "/safe/Nghiên cứu", "opaque-token", "window", "root", "path"} {
		if strings.Contains(strings.ToLower(serialized), strings.ToLower(secret)) {
			t.Fatalf("frontend result leaked %q: %s", secret, serialized)
		}
	}
	if result.Capability.Display.Label != "Nghiên cứu" {
		t.Fatalf("label=%q", result.Capability.Display.Label)
	}
}

func TestSensitiveAttachKindsRequireExplicitDecisionApproval(t *testing.T) {
	for _, kind := range []workspaceid.AttachKind{
		workspaceid.AttachIdentityConfirmationRequired,
		workspaceid.AttachRenameConfirmationRequired,
		workspaceid.AttachPathReuseConfirmationRequired,
		workspaceid.AttachAmbiguousConfirmationRequired,
	} {
		t.Run(string(kind), func(t *testing.T) {
			log := &callLog{}
			service, authority, _, attacher, _, _ := newTestService(log)
			attacher.decision = validDecision(kind)
			authority.attachDecision = false
			result, err := service.ChooseAndActivateWorkspace(context.Background())
			if err != nil || result.Status != ActivationCancelled {
				t.Fatalf("result=%#v err=%v", result, err)
			}
			want := []string{"window", "choose", "validate", "begin-attach", "confirm-decision", "cancel-attach"}
			if got := log.snapshot(); !reflect.DeepEqual(got, want) {
				t.Fatalf("calls=%v", got)
			}
		})
	}
}

func TestMissingWindowStopsBeforeNativeAuthority(t *testing.T) {
	log := &callLog{}
	service, _, _, _, _, _ := newTestService(log)
	service.windows = &windowResolverStub{log: log, err: errStub}
	_, err := service.ChooseAndActivateWorkspace(context.Background())
	if !errors.Is(err, ErrWindowUnavailable) || strings.Contains(err.Error(), "/private") {
		t.Fatalf("err=%v", err)
	}
	if got := log.snapshot(); !reflect.DeepEqual(got, []string{"window"}) {
		t.Fatalf("calls=%v", got)
	}
}

var _ session.Runtime = (*runtimeSpy)(nil)
