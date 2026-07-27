package appstate

import (
	"bytes"
	"context"
	"errors"
	"sort"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appprivate"
)

func (store *Store) RecordActivation(ctx context.Context, id workspaceid.WorkspaceID, at time.Time) error {
	if store == nil || store.raw == nil || ctx == nil || !id.Valid() {
		return ErrInvalidState
	}
	at = at.UTC()
	if !validStateTime(at) {
		return ErrInvalidState
	}
	return store.update(ctx, func(snapshot *Snapshot) error {
		effectiveAt := at
		filtered := snapshot.Recent[:0]
		for _, recent := range snapshot.Recent {
			if recent.WorkspaceID == id {
				if recent.ActivatedAt.After(effectiveAt) {
					effectiveAt = recent.ActivatedAt
				}
				continue
			}
			filtered = append(filtered, recent)
		}
		snapshot.Recent = append(filtered, RecentWorkspace{WorkspaceID: id, ActivatedAt: effectiveAt})
		sort.Slice(snapshot.Recent, func(i, j int) bool {
			return recentBefore(snapshot.Recent[i], snapshot.Recent[j])
		})
		if len(snapshot.Recent) > MaxRecentWorkspaces {
			for _, evicted := range snapshot.Recent[MaxRecentWorkspaces:] {
				delete(snapshot.Views, evicted.WorkspaceID)
			}
			snapshot.Recent = snapshot.Recent[:MaxRecentWorkspaces]
		}
		snapshot.LastWorkspaceID = snapshot.Recent[0].WorkspaceID
		return nil
	})
}

func (store *Store) SaveView(ctx context.Context, id workspaceid.WorkspaceID, view WorkspaceView) error {
	if store == nil || store.raw == nil || ctx == nil || !id.Valid() || view.Validate() != nil {
		return ErrInvalidState
	}
	return store.update(ctx, func(snapshot *Snapshot) error {
		if !snapshotHasWorkspace(*snapshot, id) {
			return ErrInvalidState
		}
		snapshot.Views[id] = cloneView(view)
		return nil
	})
}

func (store *Store) RemoveRecent(ctx context.Context, id workspaceid.WorkspaceID) error {
	if store == nil || store.raw == nil || ctx == nil || !id.Valid() {
		return ErrInvalidState
	}
	return store.update(ctx, func(snapshot *Snapshot) error {
		found := false
		filtered := snapshot.Recent[:0]
		for _, recent := range snapshot.Recent {
			if recent.WorkspaceID == id {
				found = true
				continue
			}
			filtered = append(filtered, recent)
		}
		if !found {
			return errNoStateChange
		}
		snapshot.Recent = filtered
		delete(snapshot.Views, id)
		if snapshot.LastWorkspaceID == id {
			snapshot.LastWorkspaceID = ""
		}
		return nil
	})
}

var errNoStateChange = errors.New("recent activity state is unchanged")

func (store *Store) update(ctx context.Context, mutate func(*Snapshot) error) error {
	_, err := store.raw.Update(ctx, func(current appprivate.Snapshot) (appprivate.Mutation, error) {
		snapshot := emptySnapshot()
		if current.Exists {
			var err error
			snapshot, err = decodeSnapshot(current.Data)
			if err != nil {
				return appprivate.Mutation{}, err
			}
		}
		before := snapshot.Revision
		if err := mutate(&snapshot); err != nil {
			if errors.Is(err, errNoStateChange) {
				return appprivate.Mutation{}, errNoStateChange
			}
			return appprivate.Mutation{}, err
		}
		if before == ^uint64(0) {
			return appprivate.Mutation{}, ErrInvalidState
		}
		snapshot.Revision++
		raw, err := encodeSnapshot(snapshot)
		if err != nil {
			return appprivate.Mutation{}, err
		}
		return appprivate.Mutation{Data: raw}, nil
	})
	if errors.Is(err, errNoStateChange) {
		return nil
	}
	if errors.Is(err, ErrCorruptState) || errors.Is(err, ErrInvalidState) {
		return err
	}
	if err != nil {
		store.rawUpdateErrorHook(err)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("recent activity update failed")
	}
	return nil
}

func snapshotHasWorkspace(snapshot Snapshot, id workspaceid.WorkspaceID) bool {
	for _, recent := range snapshot.Recent {
		if recent.WorkspaceID == id {
			return true
		}
	}
	return false
}

func cloneView(view WorkspaceView) WorkspaceView {
	cloned := WorkspaceView{Focus: view.Focus}
	if view.Artifact != nil {
		artifact := *view.Artifact
		cloned.Artifact = &artifact
	}
	return cloned
}

func sameRaw(left, right []byte) bool { return bytes.Equal(left, right) }
