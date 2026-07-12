package index

import (
	"context"
	"os"
)

func (store *Store) Status(ctx context.Context, request StatusRequest) (IndexStatus, error) {
	if request.Disabled {
		return IndexStatus{State: StateDisabled}, nil
	}
	if request.SnapshotHash != "" && !lowerHex64.MatchString(request.SnapshotHash) ||
		request.ChunkerVersion != "" && !versionToken.MatchString(request.ChunkerVersion) ||
		request.ProfileFingerprint != "" && !lowerHex64.MatchString(request.ProfileFingerprint) ||
		request.Dimensions < 0 || request.Dimensions > MaxVectorDimensions {
		return IndexStatus{State: StateFailed}, nil
	}
	status := IndexStatus{State: StateEmpty}
	err := store.withLocked(ctx, func(root *os.Root) error {
		loaded, missing, err := store.load(root)
		if missing {
			return nil
		}
		if err != nil {
			status = IndexStatus{State: StateCorrupt}
			return nil
		}
		status = IndexStatus{State: StateReady, Chunks: loaded.manifest.ChunkCount, Vectors: loaded.manifest.VectorCount, Dimensions: loaded.manifest.Dimensions}
		if request.SnapshotHash != "" && request.SnapshotHash != loaded.manifest.SnapshotHash ||
			request.ChunkerVersion != "" && request.ChunkerVersion != loaded.manifest.ChunkerVersion ||
			request.ProfileFingerprint != "" && request.ProfileFingerprint != loaded.manifest.ProfileFingerprint ||
			request.Dimensions != 0 && request.Dimensions != loaded.manifest.Dimensions {
			status.State = StateStale
		}
		return nil
	})
	if err != nil {
		return IndexStatus{State: StateFailed}, err
	}
	return status, nil
}

func (store *Store) Clear(ctx context.Context) (IndexStatus, error) {
	err := store.withLocked(ctx, func(root *os.Root) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		return store.clearFiles(ctx, root)
	})
	if err != nil {
		return IndexStatus{State: StateFailed}, err
	}
	return IndexStatus{State: StateEmpty}, nil
}
