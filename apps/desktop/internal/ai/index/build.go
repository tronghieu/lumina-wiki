package index

import (
	"context"
	"errors"
	"os"
	"sort"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func (store *Store) Build(ctx context.Context, request BuildRequest, sink ProgressSink) (IndexStatus, error) {
	chunks, err := store.validateBuild(request)
	if err != nil {
		return IndexStatus{State: StateFailed}, err
	}
	if err := validateManifestCapacity(request, chunks); err != nil {
		return IndexStatus{State: StateFailed}, err
	}
	var base buildBase
	err = store.withLocked(ctx, func(root *os.Root) error {
		var prepareErr error
		base, prepareErr = store.prepareBuild(root, request, chunks)
		return prepareErr
	})
	if err != nil {
		return IndexStatus{State: StateFailed}, err
	}
	if len(chunks) == 0 {
		err = store.withLocked(ctx, func(root *os.Root) error {
			if err := store.requireRevision(root, base.revision); err != nil {
				return err
			}
			return store.clearFiles(ctx, root)
		})
		if err != nil {
			return IndexStatus{State: StateFailed}, err
		}
		return IndexStatus{State: StateEmpty}, nil
	}
	needed := uniqueMissing(chunks, base.vectors)
	if err := reportProgress(ctx, sink, 0, len(needed)); err != nil {
		return IndexStatus{State: StateFailed}, err
	}
	dimensions := base.dimensions
	for start := 0; start < len(needed); start += MaxEmbeddingBatch {
		end := start + MaxEmbeddingBatch
		if end > len(needed) {
			end = len(needed)
		}
		inputs := make([]string, end-start)
		for i := range inputs {
			inputs[i] = needed[start+i].text
		}
		batch, embedErr := request.Provider.Embed(ctx, EmbeddingRequest{Purpose: PurposeDocument, Inputs: inputs})
		if embedErr != nil {
			return IndexStatus{State: StateFailed}, sanitizeEmbeddingError(ctx, embedErr)
		}
		if batch.Model != request.ExpectedModel || batch.Dimensions < 1 || batch.Dimensions > MaxVectorDimensions || len(batch.Vectors) != len(inputs) || dimensions != 0 && batch.Dimensions != dimensions {
			return IndexStatus{State: StateFailed}, errors.New("embedding provider returned an invalid batch")
		}
		if dimensions == 0 {
			dimensions = batch.Dimensions
		}
		for i, vector := range batch.Vectors {
			if len(vector) != dimensions {
				return IndexStatus{State: StateFailed}, errors.New("embedding provider returned an invalid batch")
			}
			if _, err := EncodeFloat32LE(vector); err != nil {
				return IndexStatus{State: StateFailed}, errors.New("embedding provider returned an invalid batch")
			}
			base.vectors[needed[start+i].hash] = append([]float32(nil), vector...)
		}
		if err := reportProgress(ctx, sink, end, len(needed)); err != nil {
			return IndexStatus{State: StateFailed}, err
		}
	}
	manifest, refs, raw, err := assembleGeneration(chunks, base.vectors, dimensions, request)
	base.vectors = nil
	if err != nil {
		return IndexStatus{State: StateFailed}, err
	}
	err = store.withLocked(ctx, func(root *os.Root) error {
		if err := store.requireRevision(root, base.revision); err != nil {
			return err
		}
		if err := store.commit(ctx, root, manifest, refs, raw); err != nil {
			return err
		}
		_ = store.gc(root, manifest.Generation, base.previousGeneration)
		return nil
	})
	if err != nil {
		return IndexStatus{State: StateFailed}, err
	}
	return IndexStatus{State: StateReady, Chunks: manifest.ChunkCount, Vectors: manifest.VectorCount, Dimensions: manifest.Dimensions}, nil
}

type pendingContent struct{ hash, text string }

func uniqueMissing(chunks []retrieval.Chunk, vectors map[string][]float32) []pendingContent {
	seen := map[string]bool{}
	result := []pendingContent{}
	for _, chunk := range chunks {
		if _, ok := vectors[chunk.ContentHash]; !ok && !seen[chunk.ContentHash] {
			seen[chunk.ContentHash] = true
			result = append(result, pendingContent{chunk.ContentHash, chunk.Text})
		}
	}
	return result
}

func reportProgress(ctx context.Context, sink ProgressSink, completed, total int) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if sink != nil {
		if err := sink(ctx, Progress{State: StateBuilding, Completed: completed, Total: total}); err != nil {
			return err
		}
		return ctx.Err()
	}
	return nil
}

func assembleGeneration(chunks []retrieval.Chunk, vectors map[string][]float32, dimensions int, request BuildRequest) (Manifest, []VectorRef, []byte, error) {
	if dimensions < 1 || dimensions > MaxVectorDimensions {
		return Manifest{}, nil, nil, errors.New("semantic vector dimensions are invalid")
	}
	hashes := make([]string, 0, len(chunks))
	seen := map[string]bool{}
	for _, chunk := range chunks {
		if !seen[chunk.ContentHash] {
			seen[chunk.ContentHash] = true
			hashes = append(hashes, chunk.ContentHash)
		}
	}
	sort.Strings(hashes)
	offsets := map[string]int64{}
	raw := []byte{}
	for _, hash := range hashes {
		encoded, err := EncodeFloat32LE(vectors[hash])
		if err != nil || len(raw) > MaxVectorBytes-len(encoded) {
			return Manifest{}, nil, nil, errors.New("semantic vectors are invalid")
		}
		offsets[hash] = int64(len(raw))
		raw = append(raw, encoded...)
	}
	refs := make([]VectorRef, len(chunks))
	for i, chunk := range chunks {
		refs[i] = VectorRef{ChunkID: chunk.ID, ContentHash: chunk.ContentHash, Offset: offsets[chunk.ContentHash], Count: dimensions}
	}
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].Offset != refs[j].Offset {
			return refs[i].Offset < refs[j].Offset
		}
		return refs[i].ChunkID < refs[j].ChunkID
	})
	generation, err := randomGeneration()
	if err != nil {
		return Manifest{}, nil, nil, err
	}
	manifest := Manifest{Version: CurrentManifestVersion, Generation: generation, ChunkerVersion: request.ChunkerVersion, ProfileFingerprint: request.ProfileFingerprint,
		Dimensions: dimensions, SnapshotHash: request.SnapshotHash, DocumentHashes: documentHashes(chunks), ChunkCount: len(chunks), VectorCount: len(hashes)}
	return manifest, refs, raw, nil
}
