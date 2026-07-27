package appstate

import (
	"context"
	"errors"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appprivate"
)

type ResetOutcome string

const (
	Reset            ResetOutcome = "reset"
	AlreadyReset     ResetOutcome = "already_reset"
	ResetUnavailable ResetOutcome = "unavailable"
	FailedPreserved  ResetOutcome = "failed_preserved"
)

type resetCoordinator struct {
	mu sync.Mutex
}

func newResetCoordinator() *resetCoordinator { return &resetCoordinator{} }

func (store *Store) ResetRecentViewState(ctx context.Context) (ResetOutcome, error) {
	if store == nil || store.raw == nil || store.quarantine == nil || store.reset == nil || ctx == nil {
		return ResetUnavailable, ErrInvalidState
	}
	store.reset.mu.Lock()
	defer store.reset.mu.Unlock()

	current, err := store.raw.Read(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return ResetUnavailable, ctx.Err()
		}
		return ResetUnavailable, errors.New("recent activity reset is unavailable")
	}
	if !current.Exists {
		return AlreadyReset, nil
	}
	if err := store.quarantine.Write(ctx, current.Data); err != nil {
		if ctx.Err() != nil {
			return FailedPreserved, ctx.Err()
		}
		return FailedPreserved, errors.New("recent activity reset failed; state was preserved")
	}
	if err := store.resetBeforeDelete(); err != nil {
		return FailedPreserved, errors.New("recent activity reset failed; state was preserved")
	}
	_, err = store.raw.Update(ctx, func(latest appprivate.Snapshot) (appprivate.Mutation, error) {
		if !latest.Exists {
			return appprivate.Mutation{}, errAlreadyRemoved
		}
		if !sameRaw(latest.Data, current.Data) {
			return appprivate.Mutation{}, errResetConflict
		}
		return appprivate.Mutation{Delete: true}, nil
	})
	if errors.Is(err, errAlreadyRemoved) {
		return AlreadyReset, nil
	}
	if err != nil {
		if ctx.Err() != nil {
			return FailedPreserved, ctx.Err()
		}
		return FailedPreserved, errors.New("recent activity reset failed; state was preserved")
	}
	return Reset, nil
}

var (
	errAlreadyRemoved = errors.New("recent activity was already reset")
	errResetConflict  = errors.New("recent activity changed during reset")
)
