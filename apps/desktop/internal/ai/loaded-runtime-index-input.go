package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func (runtime *loadedRuntime) normalizedConfig() (settings.Config, error) {
	config, err := runtime.deps.Config.Load()
	if err != nil {
		return settings.Config{}, err
	}
	return config.Normalized()
}

func (runtime *loadedRuntime) indexInput(ctx context.Context, root string, proof os.FileInfo, profileID string) (runtimeIndexInput, error) {
	config, err := runtime.normalizedConfig()
	if err != nil || config.Embedding == nil || config.Embedding.ID != profileID {
		return runtimeIndexInput{}, ErrIndexUnavailable
	}
	lexical, err := runtime.deps.LexicalFactory(ctx, root, proof)
	if err != nil || lexical == nil {
		return runtimeIndexInput{}, ErrIndexUnavailable
	}
	chunks, err := lexical.Chunks(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return runtimeIndexInput{}, ctx.Err()
		}
		return runtimeIndexInput{}, ErrIndexUnavailable
	}
	snapshot := hex.EncodeToString(sha256.New().Sum(nil))
	if len(chunks) > 0 {
		var ok bool
		snapshot, ok = semanticSnapshot(chunks)
		if !ok {
			return runtimeIndexInput{}, ErrIndexUnavailable
		}
	}
	fingerprint, err := config.Embedding.Fingerprint()
	if err != nil {
		return runtimeIndexInput{}, ErrIndexUnavailable
	}
	store, err := runtime.deps.SemanticStoreFactory(runtime.id)
	if err != nil || nilLike(store) {
		return runtimeIndexInput{}, ErrIndexUnavailable
	}
	return runtimeIndexInput{config: config, profile: *config.Embedding, chunks: chunks, snapshot: snapshot, fingerprint: fingerprint, store: store}, nil
}

func (input runtimeIndexInput) statusRequest() index.StatusRequest {
	return index.StatusRequest{SnapshotHash: input.snapshot, ChunkerVersion: retrieval.ChunkVersion,
		ProfileFingerprint: input.fingerprint, Dimensions: input.profile.Dimensions}
}

func (input runtimeIndexInput) buildRequest(id workspaceid.WorkspaceID, provider index.EmbeddingProvider) index.BuildRequest {
	return index.BuildRequest{WorkspaceID: id, Chunks: input.chunks, SnapshotHash: input.snapshot,
		ChunkerVersion: retrieval.ChunkVersion, ProfileFingerprint: input.fingerprint,
		ExpectedModel: input.profile.Model, ExpectedDimensions: input.profile.Dimensions, Provider: provider}
}

func validIndexStatus(status index.IndexStatus, chunks, configuredDimensions int) bool {
	if status.Chunks < 0 || status.Vectors < 0 || status.Vectors > status.Chunks || status.Dimensions < 0 || status.Dimensions > index.MaxVectorDimensions {
		return false
	}
	switch status.State {
	case index.StateDisabled, index.StateEmpty, index.StateBuilding, index.StateFailed:
		return status.Chunks == 0 && status.Vectors == 0 && status.Dimensions == 0
	case index.StateReady:
		return status.Chunks == chunks && status.Vectors == chunks && status.Dimensions > 0 && (configuredDimensions == 0 || status.Dimensions == configuredDimensions)
	case index.StateStale, index.StateCorrupt:
		return true
	default:
		return false
	}
}

func validStoredIndexStatus(status index.IndexStatus, chunks, configuredDimensions int) bool {
	if status.State == index.StateDisabled || status.State == index.StateBuilding {
		return false
	}
	return validIndexStatus(status, chunks, configuredDimensions)
}
