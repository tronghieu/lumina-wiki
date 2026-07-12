package ai

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type failingCloseRuntime struct {
	closes atomic.Int32
}

func (runtime *failingCloseRuntime) Close() error {
	runtime.closes.Add(1)
	return errStub
}

func TestDeactivateCleanupFailureRetiresCapabilityAndRetryIsRejected(t *testing.T) {
	registry := session.NewRegistry(session.Options{})
	runtime := &failingCloseRuntime{}
	capability, err := registry.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "Workspace"}, runtime)
	if err != nil {
		t.Fatal(err)
	}
	log := &callLog{}
	service, _, _, _, _, _ := newTestService(log)
	service.sessions = registry
	reference := SessionReferenceDTO{SessionID: capability.SessionID, Generation: capability.Generation}

	err = service.DeactivateWorkspace(context.Background(), reference)
	if !errors.Is(err, ErrSessionCleanup) || strings.Contains(err.Error(), "/private") || runtime.closes.Load() != 1 {
		t.Fatalf("deactivate=%v closes=%d", err, runtime.closes.Load())
	}
	if _, resolveErr := registry.Resolve(7, capability.Reference()); !errors.Is(resolveErr, session.ErrInvalidSession) {
		t.Fatalf("capability remained active: %v", resolveErr)
	}
	if retryErr := service.DeactivateWorkspace(context.Background(), reference); !errors.Is(retryErr, ErrSessionRejected) {
		t.Fatalf("retry=%v", retryErr)
	}
	if runtime.closes.Load() != 1 {
		t.Fatalf("retry closed runtime again: %d", runtime.closes.Load())
	}
}

func TestDeactivateClassifiesOnlyInvalidSessionAsRejected(t *testing.T) {
	for name, test := range map[string]struct {
		registryError error
		want          error
	}{
		"invalid capability": {session.ErrInvalidSession, ErrSessionRejected},
		"runtime cleanup":    {session.ErrRuntimeClose, ErrSessionCleanup},
		"internal failure":   {errStub, ErrSessionCleanup},
	} {
		t.Run(name, func(t *testing.T) {
			log := &callLog{}
			service, _, _, _, _, registry := newTestService(log)
			registry.deactivateErr = test.registryError
			err := service.DeactivateWorkspace(context.Background(), SessionReferenceDTO{})
			if !errors.Is(err, test.want) || strings.Contains(err.Error(), "/private") {
				t.Fatalf("err=%v want=%v", err, test.want)
			}
		})
	}
}

func TestShutdownCleanupErrorsUseSessionCleanupClassification(t *testing.T) {
	log := &callLog{}
	service, _, _, _, _, registry := newTestService(log)
	registry.closeWindowErr = errStub
	if err := CloseWindow(service, 7); !errors.Is(err, ErrSessionCleanup) || strings.Contains(err.Error(), "/private") {
		t.Fatalf("window close=%v", err)
	}
	registry.closeErr = errStub
	if err := Close(service); !errors.Is(err, ErrSessionCleanup) || strings.Contains(err.Error(), "/private") {
		t.Fatalf("service close=%v", err)
	}
}
