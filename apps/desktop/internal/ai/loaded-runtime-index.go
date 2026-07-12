package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

var (
	ErrIndexUnavailable = errors.New("semantic index is unavailable")
	ErrIndexBuildActive = errors.New("semantic index build is already active")
)

type runtimeIndexMutation struct {
	kind       runtimeIndexMutationKind
	profileID  string
	generation uint64
	cancel     context.CancelFunc
}

type runtimeIndexInput struct {
	config      settings.Config
	profile     settings.Profile
	chunks      []retrieval.Chunk
	snapshot    string
	fingerprint string
	store       RuntimeSemanticStore
}

func (runtime *loadedRuntime) IndexStatus(parent context.Context, profileID string) (index.IndexStatus, error) {
	ctx, root, proof, finish, err := runtime.begin(parent)
	if err != nil {
		return index.IndexStatus{}, err
	}
	defer finish()
	if profileID == "" {
		config, loadErr := runtime.normalizedConfig()
		if loadErr != nil || config.Embedding != nil {
			return index.IndexStatus{}, ErrIndexUnavailable
		}
		return index.IndexStatus{State: index.StateDisabled}, nil
	}
	input, err := runtime.indexInput(ctx, root, proof, profileID)
	if err != nil {
		return index.IndexStatus{}, err
	}
	if runtime.indexBuilding(profileID) {
		return index.IndexStatus{State: index.StateBuilding}, nil
	}
	status, err := input.store.Status(ctx, input.statusRequest())
	if ctx.Err() != nil {
		return index.IndexStatus{}, ctx.Err()
	}
	if err != nil || !validStoredIndexStatus(status, len(input.chunks), input.profile.Dimensions) {
		return index.IndexStatus{}, ErrIndexUnavailable
	}
	return status, nil
}

func (runtime *loadedRuntime) BuildIndex(parent context.Context, profileID string) (index.IndexStatus, error) {
	ctx, root, proof, finish, err := runtime.begin(parent)
	if err != nil {
		return index.IndexStatus{}, err
	}
	defer finish()
	buildCtx, done, err := runtime.startIndexBuild(ctx, profileID)
	if err != nil {
		return index.IndexStatus{}, err
	}
	defer done()
	input, err := runtime.indexInput(buildCtx, root, proof, profileID)
	if err != nil {
		return index.IndexStatus{}, err
	}
	var provider index.EmbeddingProvider
	if len(input.chunks) > 0 {
		provider, err = runtime.deps.EmbeddingProviderFactory(input.profile, index.FactoryOptions{WorkspaceID: runtime.id,
			Config: input.config, Client: runtime.deps.Client, Credentials: runtime.deps.Credentials})
		if err != nil || nilLike(provider) {
			return index.IndexStatus{}, ErrIndexUnavailable
		}
	}
	status, err := input.store.Build(buildCtx, input.buildRequest(runtime.id, provider), nil)
	if buildCtx.Err() != nil {
		return index.IndexStatus{}, buildCtx.Err()
	}
	expected := index.StateReady
	if len(input.chunks) == 0 {
		expected = index.StateEmpty
	}
	if err != nil || status.State != expected || !validIndexStatus(status, len(input.chunks), input.profile.Dimensions) {
		return index.IndexStatus{}, ErrIndexUnavailable
	}
	return status, nil
}

func (runtime *loadedRuntime) CancelIndex(parent context.Context, profileID string) (bool, error) {
	_, _, _, finish, err := runtime.begin(parent)
	if err != nil {
		return false, err
	}
	defer finish()
	runtime.indexMu.Lock()
	defer runtime.indexMu.Unlock()
	if runtime.indexMutation == nil || runtime.indexMutation.kind != runtimeIndexMutationBuild || runtime.indexMutation.profileID != profileID {
		return false, nil
	}
	runtime.indexMutation.cancel()
	return true, nil
}

func (runtime *loadedRuntime) ClearIndex(parent context.Context, profileID string) (index.IndexStatus, error) {
	ctx, root, proof, finish, err := runtime.begin(parent)
	if err != nil {
		return index.IndexStatus{}, err
	}
	defer finish()
	done, err := runtime.startIndexClear()
	if err != nil {
		return index.IndexStatus{}, err
	}
	defer done()
	input, err := runtime.indexInput(ctx, root, proof, profileID)
	if err != nil {
		return index.IndexStatus{}, err
	}
	status, err := input.store.Clear(ctx)
	if ctx.Err() != nil {
		return index.IndexStatus{}, ctx.Err()
	}
	if err != nil || status.State != index.StateEmpty {
		return index.IndexStatus{}, ErrIndexUnavailable
	}
	return status, nil
}
