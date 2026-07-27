package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestWailsWindowResolverRequiresTrustedContextWindow(t *testing.T) {
	resolver := NewWailsWindowResolver()
	for name, ctx := range map[string]context.Context{
		"nil context":   nil,
		"missing value": context.Background(),
		"wrong type":    context.WithValue(context.Background(), application.WindowKey, "7"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := resolver.ResolveWindow(ctx); !errors.Is(err, ErrWindowUnavailable) {
				t.Fatalf("err=%v", err)
			}
		})
	}
	var nilWindow *application.WebviewWindow
	typedNil := context.WithValue(context.Background(), application.WindowKey, nilWindow)
	if _, err := resolver.ResolveWindow(typedNil); !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("typed nil err=%v", err)
	}

	window := application.NewWindow(application.WebviewWindowOptions{Name: "resolver-test"})
	ctx := context.WithValue(context.Background(), application.WindowKey, window)
	got, err := resolver.ResolveWindow(ctx)
	if err != nil || got != session.WindowID(window.ID()) || got == 0 {
		t.Fatalf("window=%d err=%v", got, err)
	}
}

type legacyValidatorStub struct {
	result workspace.ValidationResult
	err    error
	calls  int
	cancel context.CancelFunc
}

func (stub *legacyValidatorStub) Validate(string) (workspace.ValidationResult, error) {
	stub.calls++
	if stub.cancel != nil {
		stub.cancel()
	}
	return stub.result, stub.err
}

func TestWorkspaceValidatorAdapterChecksCancellationAndHidesLegacyData(t *testing.T) {
	legacy := &legacyValidatorStub{result: workspace.ValidationResult{Root: "/private/root", Valid: true, Packs: []string{"secret-pack"}}}
	adapter, err := NewWorkspaceValidatorAdapter(legacy)
	if err != nil {
		t.Fatal(err)
	}
	shape, err := adapter.Validate(context.Background(), "/private/root")
	if err != nil || shape != (WorkspaceShape{Valid: true}) {
		t.Fatalf("shape=%#v err=%v", shape, err)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := adapter.Validate(cancelled, "/private/root"); !errors.Is(err, ErrInvalidWorkspace) || legacy.calls != 1 {
		t.Fatalf("pre-cancel err=%v calls=%d", err, legacy.calls)
	}

	during, cancelDuring := context.WithCancel(context.Background())
	legacy.cancel = cancelDuring
	if _, err := adapter.Validate(during, "/private/root"); !errors.Is(err, ErrInvalidWorkspace) {
		t.Fatalf("post-cancel err=%v", err)
	}
	legacy.cancel = nil
	legacy.err = errStub
	if _, err := adapter.Validate(context.Background(), "/private/root"); !errors.Is(err, ErrInvalidWorkspace) {
		t.Fatalf("legacy err=%v", err)
	}
}

func TestWorkspaceValidatorConstructorRejectsTypedNil(t *testing.T) {
	var legacy *legacyValidatorStub
	if _, err := NewWorkspaceValidatorAdapter(legacy); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("err=%v", err)
	}
}
