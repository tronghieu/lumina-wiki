package index

import (
	"errors"
	"io"
	"io/fs"
	"os"
)

type loadedGeneration struct {
	manifest Manifest
	refs     []VectorRef
	vectors  map[string][]float32
}

func (store *Store) readIndexFile(root *os.Root, name string, limit int64) ([]byte, bool, error) {
	info, err := root.Lstat(name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, true, nil
	}
	if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() || !privateIndexFile(info) || info.Size() < 0 || info.Size() > limit {
		return nil, false, errors.New("semantic index file is unsafe")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, false, errors.New("open semantic index file failed")
	}
	defer file.Close()
	if store.validate(file) != nil {
		return nil, false, errors.New("validate semantic index file failed")
	}
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, false, errors.New("semantic index file changed")
	}
	raw, err := io.ReadAll(&io.LimitedReader{R: file, N: limit + 1})
	if err != nil || int64(len(raw)) > limit {
		return nil, false, errors.New("read semantic index file failed")
	}
	return raw, false, nil
}

func (store *Store) load(root *os.Root) (*loadedGeneration, bool, error) {
	raw, missing, err := store.readIndexFile(root, manifestName, MaxManifestBytes)
	if err != nil || missing {
		return nil, missing, err
	}
	manifest, err := DecodeManifest(raw)
	if err != nil {
		return nil, false, err
	}
	metadataName := "chunks." + manifest.Generation + ".jsonl"
	vectorsName := "vectors." + manifest.Generation + ".f32"
	metadata, missing, err := store.readIndexFile(root, metadataName, MaxMetadataBytes)
	if err != nil || missing {
		return nil, false, errors.New("semantic index generation is incomplete")
	}
	vectorsRaw, missing, err := store.readIndexFile(root, vectorsName, MaxVectorBytes)
	if err != nil || missing {
		return nil, false, errors.New("semantic index generation is incomplete")
	}
	refs, err := DecodeVectorRefs(metadata, manifest.ChunkCount, manifest.VectorCount, manifest.Dimensions, int64(len(vectorsRaw)))
	if err != nil {
		return nil, false, err
	}
	vectors := make(map[string][]float32, manifest.VectorCount)
	for _, ref := range refs {
		if existing, ok := vectors[ref.ContentHash]; ok {
			if len(existing) != ref.Count {
				return nil, false, errors.New("semantic index vector reference is invalid")
			}
			continue
		}
		end := ref.Offset + int64(ref.Count)*4
		vector, err := DecodeFloat32LE(vectorsRaw[ref.Offset:end], ref.Count)
		if err != nil {
			return nil, false, err
		}
		vectors[ref.ContentHash] = vector
	}
	if len(vectors) != manifest.VectorCount {
		return nil, false, errors.New("semantic index vector count is invalid")
	}
	return &loadedGeneration{manifest: manifest, refs: refs, vectors: vectors}, false, nil
}
