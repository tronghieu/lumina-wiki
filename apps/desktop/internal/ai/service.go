package ai

import (
	"context"
	"path"
	"reflect"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

type Service struct {
	windows   WindowResolver
	native    NativeAuthority
	validator WorkspaceValidator
	attacher  WorkspaceAttacher
	runtimes  RuntimeFactory
	sessions  SessionRegistry
}

func NewService(dependencies Dependencies) (*Service, error) {
	if dependencies.Windows == nil || dependencies.Native == nil || dependencies.Validator == nil ||
		dependencies.Attacher == nil || dependencies.Runtimes == nil || dependencies.Sessions == nil {
		return nil, ErrInvalidInput
	}
	return &Service{dependencies.Windows, dependencies.Native, dependencies.Validator,
		dependencies.Attacher, dependencies.Runtimes, dependencies.Sessions}, nil
}

func (service *Service) ChooseAndActivateWorkspace(ctx context.Context) (ActivationResult, error) {
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return ActivationResult{}, err
	}
	selection, err := service.native.ChooseDirectory(ctx, window)
	if err != nil {
		return ActivationResult{}, ErrNativeAuthority
	}
	if !selection.Approved {
		return cancelledResult(), nil
	}
	if !validTypedRoot(selection.Path) {
		return ActivationResult{}, ErrInvalidWorkspace
	}
	return service.activateApproved(ctx, window, selection.Path)
}

func (service *Service) ConfirmAndActivateWorkspace(ctx context.Context, typedRoot string) (ActivationResult, error) {
	if !validTypedRoot(typedRoot) {
		return ActivationResult{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return ActivationResult{}, err
	}
	approved, err := service.native.ConfirmDirectory(ctx, window, typedRoot)
	if err != nil {
		return ActivationResult{}, ErrNativeAuthority
	}
	if !approved {
		return cancelledResult(), nil
	}
	return service.activateApproved(ctx, window, typedRoot)
}

func (service *Service) activateApproved(ctx context.Context, window session.WindowID, root string) (result ActivationResult, resultErr error) {
	shape, err := service.validator.Validate(ctx, root)
	if err != nil || !shape.Valid {
		return ActivationResult{}, ErrInvalidWorkspace
	}
	decision, err := service.attacher.BeginAttach(root)
	if err != nil {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	pending := true
	defer func() {
		if pending {
			if err := service.attacher.CancelAttach(decision.Token); err != nil {
				result = ActivationResult{}
				resultErr = ErrWorkspaceAttach
			}
		}
	}()

	if decisionNeedsConfirmation(decision.Kind) {
		approved, approvalErr := service.native.ConfirmAttachDecision(ctx, window, decision.Kind)
		if approvalErr != nil {
			return ActivationResult{}, ErrNativeAuthority
		}
		if !approved {
			pending = false
			if err := service.attacher.CancelAttach(decision.Token); err != nil {
				return ActivationResult{}, ErrWorkspaceAttach
			}
			return cancelledResult(), nil
		}
	} else if decision.Kind != workspaceid.AttachNew && decision.Kind != workspaceid.AttachKnown {
		return ActivationResult{}, ErrWorkspaceAttach
	}

	label, err := displayBasename(decision.CanonicalPath)
	if err != nil {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	pending = false
	workspaceID, err := service.attacher.ConfirmAttach(decision.Token)
	if err != nil || !workspaceID.Valid() {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	runtime, err := service.runtimes.Load(ctx, workspaceID, decision.CanonicalPath)
	if err != nil || !validRuntime(runtime) {
		closeRuntime(runtime)
		return ActivationResult{}, ErrRuntimeLoad
	}
	owned := &onceRuntime{runtime: runtime}
	capability, err := service.sessions.Activate(window, workspaceID, session.DisplayMetadata{Label: label}, owned)
	if err != nil {
		_ = owned.Close()
		return ActivationResult{}, ErrActivation
	}
	return activeResult(capability), nil
}

func (service *Service) resolveWindow(ctx context.Context) (session.WindowID, error) {
	if service == nil || service.windows == nil {
		return 0, ErrWindowUnavailable
	}
	window, err := service.windows.ResolveWindow(ctx)
	if err != nil || window == 0 {
		return 0, ErrWindowUnavailable
	}
	return window, nil
}

type onceRuntime struct {
	once    sync.Once
	runtime session.Runtime
}

func (runtime *onceRuntime) Close() error {
	var err error
	runtime.once.Do(func() { err = runtime.runtime.Close() })
	return err
}

func closeRuntime(runtime session.Runtime) {
	if validRuntime(runtime) {
		_ = runtime.Close()
	}
}

func validTypedRoot(root string) bool {
	if root == "" || len(root) > MaxTypedRootBytes || !utf8.ValidString(root) || strings.TrimSpace(root) == "" {
		return false
	}
	for _, character := range root {
		if unicode.IsControl(character) || unicode.Is(unicode.Cf, character) {
			return false
		}
	}
	return true
}

func validRuntime(runtime session.Runtime) bool {
	if runtime == nil {
		return false
	}
	value := reflect.ValueOf(runtime)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return !value.IsNil()
	default:
		return true
	}
}

func displayBasename(root string) (string, error) {
	normalized := strings.TrimRight(strings.ReplaceAll(root, `\`, "/"), "/")
	label := path.Base(normalized)
	if label == "" || label == "." || label == ".." || len(label) > 256 || !utf8.ValidString(label) || strings.ContainsAny(label, `/\`) {
		return "", ErrWorkspaceAttach
	}
	for _, character := range label {
		if !unicode.IsPrint(character) || unicode.Is(unicode.Cf, character) {
			return "", ErrWorkspaceAttach
		}
	}
	return label, nil
}
