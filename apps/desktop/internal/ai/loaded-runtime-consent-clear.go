package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
)

func (runtime *loadedRuntime) ClearIndexForConsent(parent context.Context, profileID string) (index.IndexStatus, error) {
	ctx, root, proof, finish, err := runtime.begin(parent)
	if err != nil {
		return index.IndexStatus{}, err
	}
	defer finish()
	mutation := runtime.activeConsentMutation(profileID)
	if mutation == nil {
		return index.IndexStatus{}, ErrIndexBuildActive
	}
	input, err := runtime.indexInput(ctx, root, proof, profileID)
	if err != nil {
		return index.IndexStatus{}, err
	}
	status, err := input.store.Clear(ctx)
	if ctx.Err() != nil {
		return index.IndexStatus{}, ctx.Err()
	}
	if err != nil || status.State != index.StateEmpty || runtime.activeConsentMutation(profileID) != mutation {
		return index.IndexStatus{}, ErrIndexUnavailable
	}
	return status, nil
}

func (runtime *loadedRuntime) activeConsentMutation(profileID string) *runtimeIndexMutation {
	runtime.indexMu.Lock()
	defer runtime.indexMu.Unlock()
	mutation := runtime.indexMutation
	if mutation == nil || mutation.kind != runtimeIndexMutationConsent || mutation.profileID != profileID {
		return nil
	}
	return mutation
}
