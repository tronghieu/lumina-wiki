package ai

import (
	"context"
	"path"
	"reflect"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type Service struct {
	windows     WindowResolver
	native      NativeAuthority
	validator   WorkspaceValidator
	attacher    WorkspaceAttacher
	runtimes    RuntimeFactory
	sessions    SessionRegistry
	streams     StreamSinkFactory
	activations *activationGate
}

func NewService(dependencies Dependencies) (*Service, error) {
	if dependencies.Windows == nil || dependencies.Native == nil || dependencies.Validator == nil ||
		dependencies.Attacher == nil || dependencies.Runtimes == nil || dependencies.Sessions == nil || dependencies.Streams == nil {
		return nil, ErrInvalidInput
	}
	return &Service{
		windows: dependencies.Windows, native: dependencies.Native, validator: dependencies.Validator,
		attacher: dependencies.Attacher, runtimes: dependencies.Runtimes, sessions: dependencies.Sessions, streams: dependencies.Streams,
		activations: newActivationGate(),
	}, nil
}

func (service *Service) ChooseAndActivateWorkspace(ctx context.Context) (ActivationResult, error) {
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return ActivationResult{}, err
	}
	lease, err := service.activations.Acquire(ctx, window)
	if err != nil {
		return ActivationResult{}, err
	}
	defer lease.Finish()
	selection, err := service.native.ChooseDirectory(lease.Context(), window)
	if leaseErr := lease.Validate(); leaseErr != nil {
		return ActivationResult{}, leaseErr
	}
	if err != nil {
		return ActivationResult{}, ErrNativeAuthority
	}
	if !selection.Approved {
		return cancelledResult(), nil
	}
	if !validTypedRoot(selection.Path) {
		return ActivationResult{}, ErrInvalidWorkspace
	}
	return service.activateApproved(lease, selection.Path)
}

func (service *Service) ConfirmAndActivateWorkspace(ctx context.Context, typedRoot string) (ActivationResult, error) {
	if !validTypedRoot(typedRoot) {
		return ActivationResult{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return ActivationResult{}, err
	}
	lease, err := service.activations.Acquire(ctx, window)
	if err != nil {
		return ActivationResult{}, err
	}
	defer lease.Finish()
	approved, err := service.native.ConfirmDirectory(lease.Context(), window, typedRoot)
	if leaseErr := lease.Validate(); leaseErr != nil {
		return ActivationResult{}, leaseErr
	}
	if err != nil {
		return ActivationResult{}, ErrNativeAuthority
	}
	if !approved {
		return cancelledResult(), nil
	}
	return service.activateApproved(lease, typedRoot)
}

func (service *Service) resolveWindow(ctx context.Context) (session.WindowID, error) {
	if service == nil || service.windows == nil || ctx == nil || ctx.Err() != nil {
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
	if runtime == nil {
		return nil
	}
	runtime.once.Do(func() {
		if validRuntime(runtime.runtime) {
			err = runtime.runtime.Close()
		}
	})
	return err
}

func (runtime *onceRuntime) RunChat(ctx context.Context, request runtimeChatRequest, sink chat.EventSink) error {
	capable, ok := chatRuntimeCapability(runtime)
	if !ok {
		return ErrChatUnavailable
	}
	if err := capable.RunChat(ctx, request, sink); err != nil {
		return ErrChatUnavailable
	}
	return nil
}

func (runtime *onceRuntime) ReadCitationNote(ctx context.Context, requestID, citationID string) (retrieval.CitationNote, error) {
	capable, ok := chatRuntimeCapability(runtime)
	if !ok {
		return retrieval.CitationNote{}, ErrCitationUnavailable
	}
	return capable.ReadCitationNote(ctx, requestID, citationID)
}

func chatRuntimeCapability(runtime *onceRuntime) (chatCapableRuntime, bool) {
	if runtime == nil || !validRuntime(runtime.runtime) {
		return nil, false
	}
	capable, ok := runtime.runtime.(chatCapableRuntime)
	return capable, ok && validRuntime(capable)
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
