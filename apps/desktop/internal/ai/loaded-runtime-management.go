package ai

import (
	"context"
	"errors"
	"os"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

func (runtime *loadedRuntime) WorkspaceTree(parent context.Context) (workspace.WorkspaceTree, error) {
	ctx, root, proof, finish, err := runtime.begin(parent)
	if err != nil {
		return workspace.WorkspaceTree{}, err
	}
	defer finish()
	return runtime.deps.Tree.BuildTrusted(ctx, root, proof)
}

func (runtime *loadedRuntime) ValidateTrustedRoot(parent context.Context) error {
	ctx, root, proof, finish, err := runtime.begin(parent)
	if err != nil {
		return err
	}
	defer finish()
	current, err := os.Lstat(root)
	if err != nil || current == nil || !current.IsDir() || !os.SameFile(current, proof) ||
		ctx.Err() != nil {
		return errors.New("trusted workspace is unavailable")
	}
	return nil
}

func (runtime *loadedRuntime) ReadWorkspaceNote(
	parent context.Context,
	locator string,
) (graph.NoteContent, error) {
	ctx, root, proof, finish, err := runtime.begin(parent)
	if err != nil {
		return graph.NoteContent{}, err
	}
	defer finish()
	return graph.NewService().ReadNoteTrusted(ctx, root, proof, locator)
}

func (runtime *loadedRuntime) HistoryEnabled(parent context.Context) (bool, error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return false, err
	}
	defer finish()
	store, err := runtime.newHistoryStore()
	if err != nil {
		return false, err
	}
	return store.Enabled(ctx)
}

func (runtime *loadedRuntime) SetHistoryEnabled(parent context.Context, enabled bool) error {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return err
	}
	defer finish()
	store, err := runtime.newHistoryStore()
	if err != nil {
		return err
	}
	return store.SetEnabled(ctx, enabled)
}

func (runtime *loadedRuntime) ListHistory(parent context.Context) ([]history.ConversationMetadata, error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return nil, err
	}
	defer finish()
	store, err := runtime.newHistoryStore()
	if err != nil {
		return nil, err
	}
	return store.List(ctx)
}

func (runtime *loadedRuntime) LoadHistory(parent context.Context, conversationID string) ([]history.ConversationRecord, error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return nil, err
	}
	defer finish()
	store, err := runtime.newHistoryStore()
	if err != nil {
		return nil, err
	}
	return store.Load(ctx, conversationID)
}

func (runtime *loadedRuntime) LoadLatestHistory(parent context.Context) (history.LatestResult, error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return history.LatestResult{Status: history.LatestUnavailable}, err
	}
	defer finish()
	store, err := runtime.newHistoryStore()
	if err != nil {
		return history.LatestResult{Status: history.LatestUnavailable}, err
	}
	return store.LoadLatest(ctx)
}

func (runtime *loadedRuntime) DeleteHistory(parent context.Context, conversationID string) (history.DeleteResult, error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return history.DeleteResult{}, err
	}
	defer finish()
	store, err := runtime.newHistoryStore()
	if err != nil {
		return history.DeleteResult{}, err
	}
	return store.Delete(ctx, conversationID)
}

func (runtime *loadedRuntime) DeleteAllHistory(parent context.Context) (history.DeleteAllResult, error) {
	ctx, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return history.DeleteAllResult{}, err
	}
	defer finish()
	store, err := runtime.newHistoryStore()
	if err != nil {
		return history.DeleteAllResult{}, err
	}
	return store.DeleteAll(ctx)
}
