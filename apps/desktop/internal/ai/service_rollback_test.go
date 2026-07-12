package ai

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestPendingAttachRollbackFailureIsSanitizedAndPreservesOldSession(t *testing.T) {
	tests := map[string]struct {
		configure     func(*nativeAuthorityStub, *attacherStub)
		calls         []string
		originalError error
	}{
		"decision prompt error": {
			configure: func(authority *nativeAuthorityStub, attacher *attacherStub) {
				attacher.decision = validDecision(workspaceid.AttachRenameConfirmationRequired)
				authority.attachPromptErr = errStub
			},
			calls:         []string{"window", "choose", "validate", "begin-attach", "confirm-decision", "cancel-attach"},
			originalError: ErrNativeAuthority,
		},
		"unknown decision kind": {
			configure: func(_ *nativeAuthorityStub, attacher *attacherStub) {
				attacher.decision = validDecision(workspaceid.AttachKind("future-kind"))
			},
			calls:         []string{"window", "choose", "validate", "begin-attach", "cancel-attach"},
			originalError: ErrWorkspaceAttach,
		},
		"unsafe canonical basename": {
			configure: func(_ *nativeAuthorityStub, attacher *attacherStub) {
				attacher.decision.CanonicalPath = "/trusted/bad\u202Ename"
			},
			calls:         []string{"window", "choose", "validate", "begin-attach", "cancel-attach"},
			originalError: ErrWorkspaceAttach,
		},
	}

	for name, test := range tests {
		for _, rollbackFails := range []bool{false, true} {
			t.Run(name+map[bool]string{false: "/rollback succeeds", true: "/rollback fails"}[rollbackFails], func(t *testing.T) {
				registry := session.NewRegistry(session.Options{})
				oldRuntime := &runtimeSpy{}
				old, err := registry.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "Old workspace"}, oldRuntime)
				if err != nil {
					t.Fatal(err)
				}
				log := &callLog{}
				service, authority, _, attacher, _, _ := newTestService(log)
				service.sessions = registry
				test.configure(authority, attacher)
				if rollbackFails {
					attacher.cancelErr = errStub
				}

				_, err = service.ChooseAndActivateWorkspace(context.Background())
				wantErr := test.originalError
				if rollbackFails {
					wantErr = ErrWorkspaceAttach
				}
				if !errors.Is(err, wantErr) || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "opaque") {
					t.Fatalf("err=%v want=%v", err, wantErr)
				}
				if got := log.snapshot(); !reflect.DeepEqual(got, test.calls) {
					t.Fatalf("calls=%v", got)
				}
				lease, resolveErr := registry.Resolve(7, old.Reference())
				if resolveErr != nil || oldRuntime.closeCount() != 0 {
					t.Fatalf("old session changed: resolve=%v closes=%d", resolveErr, oldRuntime.closeCount())
				}
				lease.Finish()
			})
		}
	}
}
