package index

import (
	"errors"
	"io/fs"
	"os"
)

type searchSnapshot struct {
	manifest Manifest
	revision string
	refs     []VectorRef
	file     *os.File
}

func (store *Store) captureSearch(root *os.Root, request SemanticSearchRequest) (*searchSnapshot, error) {
	manifestRaw, missing, err := store.readIndexFile(root, manifestName, MaxManifestBytes)
	if missing {
		return nil, ErrSemanticEmpty
	}
	if err != nil {
		return nil, ErrSemanticCorrupt
	}
	manifest, err := DecodeManifest(manifestRaw)
	if err != nil {
		return nil, ErrSemanticCorrupt
	}
	if manifest.SnapshotHash != request.SnapshotHash || manifest.ChunkerVersion != request.ChunkerVersion ||
		manifest.ProfileFingerprint != request.ProfileFingerprint || manifest.Dimensions != request.Dimensions {
		return nil, ErrSemanticStale
	}
	metadata, missing, err := store.readIndexFile(root, "chunks."+manifest.Generation+".jsonl", MaxMetadataBytes)
	if err != nil || missing {
		return nil, ErrSemanticCorrupt
	}
	name := "vectors." + manifest.Generation + ".f32"
	info, err := root.Lstat(name)
	if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() ||
		!privateIndexFile(info) || info.Size() < 0 || info.Size() > MaxVectorBytes {
		return nil, ErrSemanticCorrupt
	}
	refs, err := DecodeVectorRefs(metadata, manifest.ChunkCount, manifest.VectorCount, manifest.Dimensions, info.Size())
	if err != nil {
		return nil, ErrSemanticCorrupt
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, ErrSemanticUnavailable
	}
	ok := false
	defer func() {
		if !ok {
			file.Close()
		}
	}()
	if store.validate(file) != nil {
		return nil, ErrSemanticUnavailable
	}
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) || opened.Size() != info.Size() {
		return nil, ErrSemanticCorrupt
	}
	revision, err := indexRevision(&loadedGeneration{manifest: manifest}, false)
	if err != nil {
		return nil, ErrSemanticCorrupt
	}
	ok = true
	return &searchSnapshot{manifest: manifest, revision: revision, refs: refs, file: file}, nil
}

func semanticSearchError(ctxErr, err error) error {
	if ctxErr != nil {
		return ctxErr
	}
	if errors.Is(err, ErrSemanticEmpty) || errors.Is(err, ErrSemanticStale) ||
		errors.Is(err, ErrSemanticCorrupt) || errors.Is(err, ErrSemanticUnavailable) {
		return err
	}
	return ErrSemanticUnavailable
}
