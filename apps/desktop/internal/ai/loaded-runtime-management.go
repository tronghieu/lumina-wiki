package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
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
