package index

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type buildBase struct {
	revision           string
	previousGeneration string
	vectors            map[string][]float32
	dimensions         int
}

func indexRevision(loaded *loadedGeneration, missing bool) (string, error) {
	if missing {
		return "missing", nil
	}
	raw, err := EncodeManifest(loaded.manifest)
	if err != nil {
		return "", errors.New("existing semantic index is corrupt")
	}
	sum := sha256.Sum256(raw)
	return loaded.manifest.Generation + ":" + hex.EncodeToString(sum[:]), nil
}

func (store *Store) prepareBuild(root *os.Root, request BuildRequest, chunks []retrieval.Chunk) (buildBase, error) {
	loaded, missing, err := store.load(root)
	if err != nil {
		return buildBase{}, errors.New("existing semantic index is corrupt")
	}
	revision, err := indexRevision(loaded, missing)
	if err != nil {
		return buildBase{}, err
	}
	base := buildBase{revision: revision, vectors: map[string][]float32{}, dimensions: request.ExpectedDimensions}
	if missing {
		return base, nil
	}
	base.previousGeneration = loaded.manifest.Generation
	compatible := loaded.manifest.ProfileFingerprint == request.ProfileFingerprint && loaded.manifest.ChunkerVersion == request.ChunkerVersion &&
		(request.ExpectedDimensions == 0 || loaded.manifest.Dimensions == request.ExpectedDimensions)
	if compatible {
		base.dimensions = request.ExpectedDimensions
		if base.dimensions == 0 {
			base.dimensions = loaded.manifest.Dimensions
		}
		wanted := make(map[string]struct{}, len(chunks))
		for _, chunk := range chunks {
			wanted[chunk.ContentHash] = struct{}{}
		}
		for hash := range wanted {
			if vector, ok := loaded.vectors[hash]; ok {
				base.vectors[hash] = append([]float32(nil), vector...)
			}
		}
	}
	return base, nil
}

func (store *Store) requireRevision(root *os.Root, expected string) error {
	raw, missing, err := store.readIndexFile(root, manifestName, MaxManifestBytes)
	if err != nil {
		return ErrIndexConflict
	}
	if missing {
		if expected == "missing" {
			return nil
		}
		return ErrIndexConflict
	}
	manifest, err := DecodeManifest(raw)
	if err != nil {
		return ErrIndexConflict
	}
	current, err := indexRevision(&loadedGeneration{manifest: manifest}, false)
	if err != nil || current != expected {
		return ErrIndexConflict
	}
	return nil
}

func sanitizeEmbeddingError(ctx context.Context, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return ErrEmbeddingFailed
}
