package ai

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type workspaceResolverFunc func(session.WindowID, session.Reference) (*session.RuntimeLease, error)

func (resolve workspaceResolverFunc) Resolve(window session.WindowID, reference session.Reference) (*session.RuntimeLease, error) {
	return resolve(window, reference)
}

func TestWorkspaceWriteAuthorizerAllowsOnlyActiveWritableSession(t *testing.T) {
	registry := session.NewRegistry(session.Options{})
	readOnly, err := registry.ActivateDescriptor(session.SessionDescriptor{
		WindowID:    1,
		WorkspaceID: testWorkspaceID,
		Display:     session.DisplayMetadata{Label: "Existing"},
		AccessMode:  session.AccessReadOnly,
		Runtime:     &runtimeSpy{},
	})
	if err != nil {
		t.Fatal(err)
	}
	authorizer := NewWorkspaceWriteAuthorizer(registry)
	assertWorkspaceWriteRejected(t, authorizer, 1, readOnly.Reference())

	writableRuntime := &runtimeSpy{}
	writable, err := registry.ActivateDescriptor(session.SessionDescriptor{
		WindowID:    1,
		WorkspaceID: testWorkspaceID,
		Display:     session.DisplayMetadata{Label: "Created"},
		AccessMode:  session.AccessWritable,
		Runtime:     writableRuntime,
		RootLease:   &runtimeSpy{},
	})
	if err != nil {
		t.Fatal(err)
	}
	assertWorkspaceWriteRejected(t, authorizer, 1, readOnly.Reference())
	assertWorkspaceWriteRejected(t, authorizer, 2, writable.Reference())
	assertWorkspaceWriteRejected(t, authorizer, 1, session.Reference{
		SessionID:  session.SessionID("sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		Generation: writable.Generation,
	})

	authorization, err := authorizer.Authorize(1, writable.Reference())
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.Deactivate(1, writable.Reference()); err != nil {
		t.Fatal(err)
	}
	if writableRuntime.closeCount() != 0 {
		t.Fatal("authorization did not pin the session lease")
	}
	authorization.Finish()
	authorization.Finish()
	if writableRuntime.closeCount() != 1 {
		t.Fatalf("runtime closes=%d", writableRuntime.closeCount())
	}
}

func TestWorkspaceWriteAuthorizerFinishesLeaseReturnedWithError(t *testing.T) {
	registry := session.NewRegistry(session.Options{})
	runtime := &runtimeSpy{}
	capability, err := registry.ActivateDescriptor(session.SessionDescriptor{
		WindowID:    1,
		WorkspaceID: testWorkspaceID,
		Display:     session.DisplayMetadata{Label: "Created"},
		AccessMode:  session.AccessWritable,
		Runtime:     runtime,
		RootLease:   &runtimeSpy{},
	})
	if err != nil {
		t.Fatal(err)
	}
	resolver := workspaceResolverFunc(func(window session.WindowID, reference session.Reference) (*session.RuntimeLease, error) {
		lease, resolveErr := registry.Resolve(window, reference)
		if resolveErr != nil {
			t.Fatal(resolveErr)
		}
		return lease, errors.New("resolver failed after acquiring lease")
	})
	authorization, err := NewWorkspaceWriteAuthorizer(resolver).Authorize(1, capability.Reference())
	if authorization != nil || !errors.Is(err, ErrWorkspaceWriteRejected) {
		t.Fatalf("authorization=%#v err=%v", authorization, err)
	}
	if err := registry.Deactivate(1, capability.Reference()); err != nil {
		t.Fatal(err)
	}
	if runtime.closeCount() != 1 {
		t.Fatalf("runtime closes=%d", runtime.closeCount())
	}
}

func TestWorkspaceWriteAuthorizerUsesStableSanitizedRejection(t *testing.T) {
	var authorizer *WorkspaceWriteAuthorizer
	for name, call := range map[string]func() error{
		"nil authorizer": func() error {
			_, err := authorizer.Authorize(1, session.Reference{})
			return err
		},
		"nil resolver": func() error {
			_, err := NewWorkspaceWriteAuthorizer(nil).Authorize(1, session.Reference{})
			return err
		},
		"resolver detail": func() error {
			resolver := workspaceResolverFunc(func(session.WindowID, session.Reference) (*session.RuntimeLease, error) {
				return nil, errors.New("rejected at /private/workspace/root")
			})
			_, err := NewWorkspaceWriteAuthorizer(resolver).Authorize(1, session.Reference{})
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := call()
			if !errors.Is(err, ErrWorkspaceWriteRejected) {
				t.Fatalf("err=%v", err)
			}
			if err.Error() != "workspace write is not authorized" ||
				strings.Contains(err.Error(), "/") || strings.Contains(err.Error(), `\`) {
				t.Fatalf("unsafe error=%q", err)
			}
		})
	}
}

func TestReadOnlySessionDoesNotBlockAppLocalHistoryIndexOrSettingsWrites(t *testing.T) {
	runtime := &managementRuntimeStub{
		indexStatus: index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8},
	}
	service, capability, _ := newBridgeService(t, 7, runtime)
	if capability.AccessMode != session.AccessReadOnly {
		t.Fatalf("mode=%q", capability.AccessMode)
	}
	assertWorkspaceWriteRejected(t, NewWorkspaceWriteAuthorizer(service.sessions), 7, capability.Reference())
	reference := bridgeReference(capability)

	if _, err := service.SetHistoryEnabled(context.Background(), SetHistoryEnabledRequestDTO{
		Session: reference,
		Enabled: true,
	}); err != nil {
		t.Fatalf("app-local history write blocked: %v", err)
	}
	if _, err := service.ClearIndex(context.Background(), IndexRequestDTO{
		Session:            reference,
		EmbeddingProfileID: "embed-main",
	}); err != nil {
		t.Fatalf("app-local index write blocked: %v", err)
	}
	if _, err := service.SaveAIProfile(context.Background(), validProfileRequest("chat")); err != nil {
		t.Fatalf("app-local settings write blocked: %v", err)
	}
}

func assertWorkspaceWriteRejected(t *testing.T, authorizer *WorkspaceWriteAuthorizer, window session.WindowID, reference session.Reference) {
	t.Helper()
	authorization, err := authorizer.Authorize(window, reference)
	if authorization != nil || !errors.Is(err, ErrWorkspaceWriteRejected) {
		t.Fatalf("authorization=%#v err=%v", authorization, err)
	}
}
