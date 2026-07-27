package appstate

import (
	"context"
	"errors"
	"path/filepath"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appprivate"
)

type Store struct {
	raw                *appprivate.Store
	quarantine         *appprivate.Store
	configBase         string
	reset              *resetCoordinator
	resetBeforeDelete  func() error
	rawUpdateErrorHook func(error)
}

func NewStore(configBase string) (*Store, error) {
	if configBase == "" || !filepath.IsAbs(configBase) || filepath.Clean(configBase) != configBase {
		return nil, ErrInvalidState
	}
	raw, err := appprivate.NewStore(configBase, "recent-view-state", MaxStateBytes)
	if err != nil {
		return nil, errors.New("recent activity store is unavailable")
	}
	quarantine, err := appprivate.NewStore(configBase, "recent-view-state-quarantine", MaxStateBytes)
	if err != nil {
		return nil, errors.New("recent activity store is unavailable")
	}
	return &Store{
		raw: raw, quarantine: quarantine, configBase: configBase,
		reset:              newResetCoordinator(),
		resetBeforeDelete:  func() error { return nil },
		rawUpdateErrorHook: func(error) {},
	}, nil
}

func (store *Store) Snapshot(ctx context.Context) (Snapshot, error) {
	if store == nil || store.raw == nil || ctx == nil {
		return Snapshot{}, ErrInvalidState
	}
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	raw, err := store.raw.Read(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return Snapshot{}, ctx.Err()
		}
		return Snapshot{}, errors.New("recent activity state is unavailable")
	}
	if !raw.Exists {
		return emptySnapshot(), nil
	}
	return decodeSnapshot(raw.Data)
}

func (store *Store) rawStatePathForTest() string {
	return filepath.Join(store.configBase, "lumina-wiki-desktop", "private-state", "recent-view-state.json")
}
