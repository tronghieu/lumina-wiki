package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func (runtime *loadedRuntime) semanticConfig(ctx context.Context, config settings.Config, lexical *retrieval.Lexical,
	enabled bool) (chat.HybridConfig, error) {
	result := chat.HybridConfig{Lexical: lexical, Metadata: chat.SemanticMetadata{Enabled: enabled}}
	if !enabled {
		return result, nil
	}
	chunks, err := lexical.Chunks(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		result.SemanticSetupError = retrieval.ErrSemanticUnavailable
		return result, nil
	}
	if len(chunks) == 0 {
		result.SemanticSetupError = retrieval.ErrSemanticEmpty
		return result, nil
	}
	snapshot, ok := semanticSnapshot(chunks)
	if !ok || config.Embedding == nil {
		result.SemanticSetupError = retrieval.ErrSemanticCorrupt
		return result, nil
	}
	fingerprint, err := config.Embedding.Fingerprint()
	if err != nil {
		result.SemanticSetupError = retrieval.ErrSemanticUnavailable
		return result, nil
	}
	store, err := runtime.deps.SemanticStoreFactory(runtime.id)
	if err != nil || nilLike(store) {
		result.SemanticSetupError = retrieval.ErrSemanticUnavailable
		return result, nil
	}
	request := index.StatusRequest{SnapshotHash: snapshot, ChunkerVersion: retrieval.ChunkVersion,
		ProfileFingerprint: fingerprint, Dimensions: config.Embedding.Dimensions}
	status, err := store.Status(ctx, request)
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	setup := semanticStatusError(status.State, err)
	if setup == nil && !validReadySemantic(status, len(chunks), config.Embedding.Dimensions) {
		setup = retrieval.ErrSemanticCorrupt
	}
	if setup != nil {
		result.SemanticSetupError = setup
		return result, nil
	}
	provider, err := runtime.deps.EmbeddingProviderFactory(*config.Embedding, index.FactoryOptions{
		WorkspaceID: runtime.id, Config: config, Client: runtime.deps.Client, Credentials: runtime.deps.Credentials})
	if err != nil || nilLike(provider) {
		result.SemanticSetupError = retrieval.ErrSemanticUnavailable
		return result, nil
	}
	result.Semantic, result.Provider = store, provider
	result.Metadata = chat.SemanticMetadata{Enabled: true, SnapshotHash: snapshot, ProfileFingerprint: fingerprint,
		ChunkerVersion: retrieval.ChunkVersion, ExpectedModel: config.Embedding.Model, Dimensions: status.Dimensions}
	return result, nil
}

func semanticSnapshot(chunks []retrieval.Chunk) (string, bool) {
	snapshot := chunks[0].SnapshotHash
	if snapshot == "" {
		return "", false
	}
	for _, chunk := range chunks[1:] {
		if chunk.SnapshotHash != snapshot || chunk.SnapshotHash == "" {
			return "", false
		}
	}
	return snapshot, true
}

func semanticStatusError(state index.IndexState, err error) error {
	if err != nil {
		return retrieval.ErrSemanticUnavailable
	}
	switch state {
	case index.StateReady:
		return nil
	case index.StateEmpty:
		return retrieval.ErrSemanticEmpty
	case index.StateStale:
		return retrieval.ErrSemanticStale
	case index.StateCorrupt:
		return retrieval.ErrSemanticCorrupt
	default:
		return retrieval.ErrSemanticUnavailable
	}
}

func validReadySemantic(status index.IndexStatus, chunks, configuredDimensions int) bool {
	return status.Chunks == chunks && status.Vectors == chunks && status.Dimensions > 0 && status.Dimensions <= index.MaxVectorDimensions &&
		(configuredDimensions == 0 || configuredDimensions == status.Dimensions)
}
