package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

var (
	ErrWorkspaceTreeUnavailable = errors.New("workspace tree is unavailable")
	ErrHistoryUnavailable       = errors.New("history is unavailable")
)

type managementCapableRuntime interface {
	session.Runtime
	WorkspaceTree(context.Context) (workspace.WorkspaceTree, error)
	HistoryEnabled(context.Context) (bool, error)
	SetHistoryEnabled(context.Context, bool) error
	ListHistory(context.Context) ([]history.ConversationMetadata, error)
	LoadHistory(context.Context, string) ([]history.ConversationRecord, error)
	DeleteHistory(context.Context, string) (history.DeleteResult, error)
	DeleteAllHistory(context.Context) (history.DeleteAllResult, error)
	IndexStatus(context.Context, string) (index.IndexStatus, error)
	BuildIndex(context.Context, string) (index.IndexStatus, error)
	CancelIndex(context.Context, string) (bool, error)
	ClearIndex(context.Context, string) (index.IndexStatus, error)
}

func (service *Service) resolveManagement(ctx context.Context, reference SessionReferenceDTO) (managementCapableRuntime, *session.RuntimeLease, error) {
	if service == nil || service.sessions == nil || ctx == nil || !validSessionReferenceSyntax(reference) {
		return nil, nil, ErrInvalidInput
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return nil, nil, err
	}
	lease, err := service.sessions.Resolve(window, reference.sessionReference())
	if err != nil {
		return nil, nil, ErrSessionRejected
	}
	runtime, ok := managementRuntimeCapability(lease.Runtime())
	if !ok {
		lease.Finish()
		return nil, nil, ErrHistoryUnavailable
	}
	return runtime, lease, nil
}

func managementRuntimeCapability(runtime session.Runtime) (managementCapableRuntime, bool) {
	if wrapped, ok := runtime.(*onceRuntime); ok {
		if wrapped == nil || !validRuntime(wrapped.runtime) {
			return nil, false
		}
		runtime = wrapped.runtime
	}
	capable, ok := runtime.(managementCapableRuntime)
	return capable, ok && validRuntime(capable)
}

func managementCallError(ctx context.Context, fallback error, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return fallback
}
