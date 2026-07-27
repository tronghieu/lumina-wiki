package ai

import (
	"errors"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

var ErrWorkspaceWriteRejected = errors.New("workspace write is not authorized")

type WorkspaceSessionResolver interface {
	Resolve(session.WindowID, session.Reference) (*session.RuntimeLease, error)
}

// WorkspaceWriteAuthorizer is the single capability gate for operations that
// mutate workspace bytes. App-local history, index, and settings writes do not
// pass through this gate.
type WorkspaceWriteAuthorizer struct {
	sessions WorkspaceSessionResolver
}

type WorkspaceWriteAuthorization struct {
	once  sync.Once
	lease *session.RuntimeLease
}

func NewWorkspaceWriteAuthorizer(sessions WorkspaceSessionResolver) *WorkspaceWriteAuthorizer {
	return &WorkspaceWriteAuthorizer{sessions: sessions}
}

func (authorizer *WorkspaceWriteAuthorizer) Authorize(window session.WindowID, reference session.Reference) (*WorkspaceWriteAuthorization, error) {
	if authorizer == nil || nilLike(authorizer.sessions) {
		return nil, ErrWorkspaceWriteRejected
	}
	lease, err := authorizer.sessions.Resolve(window, reference)
	if err != nil {
		if lease != nil {
			lease.Finish()
		}
		return nil, ErrWorkspaceWriteRejected
	}
	if lease == nil {
		return nil, ErrWorkspaceWriteRejected
	}
	if lease.AccessMode() != session.AccessWritable {
		lease.Finish()
		return nil, ErrWorkspaceWriteRejected
	}
	return &WorkspaceWriteAuthorization{lease: lease}, nil
}

func (authorization *WorkspaceWriteAuthorization) Finish() {
	if authorization == nil {
		return
	}
	authorization.once.Do(func() {
		if authorization.lease != nil {
			authorization.lease.Finish()
		}
	})
}
