package index

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync/atomic"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

var semanticTempSequence atomic.Uint64

func randomGeneration() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", errors.New("create semantic generation failed")
	}
	return hex.EncodeToString(raw), nil
}

func encodeRefs(refs []VectorRef) ([]byte, error) {
	var output strings.Builder
	for _, ref := range refs {
		raw, err := json.Marshal(ref)
		if err != nil || output.Len()+len(raw)+1 > MaxMetadataBytes {
			return nil, errors.New("semantic metadata exceeds limit")
		}
		output.Write(raw)
		output.WriteByte('\n')
	}
	return []byte(output.String()), nil
}

func (store *Store) writeTemp(ctx context.Context, root *os.Root, raw []byte) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	name := fmt.Sprintf(".index-tmp-%d-%d", os.Getpid(), semanticTempSequence.Add(1))
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", errors.New("create semantic temporary file failed")
	}
	ok := false
	defer func() {
		file.Close()
		if !ok {
			root.Remove(name)
		}
	}()
	if store.protect(file, 0o600) != nil {
		return "", errors.New("protect semantic temporary file failed")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if written, writeErr := file.Write(raw); writeErr != nil || written != len(raw) {
		return "", errors.New("write semantic temporary file failed")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err = file.Sync(); err != nil {
		return "", errors.New("sync semantic temporary file failed")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err = file.Close(); err != nil {
		return "", errors.New("close semantic temporary file failed")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	ok = true
	return name, nil
}

func (store *Store) commit(ctx context.Context, root *os.Root, manifest Manifest, refs []VectorRef, vectorsRaw []byte) (err error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	metadataRaw, err := encodeRefs(refs)
	if err != nil {
		return err
	}
	manifestRaw, err := EncodeManifest(manifest)
	if err != nil {
		return err
	}
	metadataName := "chunks." + manifest.Generation + ".jsonl"
	vectorName := "vectors." + manifest.Generation + ".f32"
	items := []struct {
		name string
		raw  []byte
	}{{metadataName, metadataRaw}, {vectorName, vectorsRaw}}
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, existingErr := root.Lstat(item.name); !errors.Is(existingErr, os.ErrNotExist) {
			return errors.New("semantic generation already exists")
		}
	}
	committed := false
	created := map[string]os.FileInfo{}
	defer func() {
		if !committed {
			for name, expected := range created {
				if current, statErr := root.Lstat(name); statErr == nil && os.SameFile(expected, current) {
					root.Remove(name)
				}
			}
		}
	}()
	for _, item := range items {
		temp, writeErr := store.writeTemp(ctx, root, item.raw)
		if writeErr != nil {
			return writeErr
		}
		if renameErr := store.rename(root, temp, item.name); renameErr != nil {
			root.Remove(temp)
			return errors.New("commit semantic generation failed")
		}
		info, statErr := root.Lstat(item.name)
		if statErr != nil || !info.Mode().IsRegular() {
			return errors.New("semantic generation changed")
		}
		created[item.name] = info
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	if err = store.syncRoot(root); err != nil {
		return errors.New("sync semantic generation failed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	temp, err := store.writeTemp(ctx, root, manifestRaw)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		root.Remove(temp)
		return err
	}
	if err = store.rename(root, temp, manifestName); err != nil {
		root.Remove(temp)
		return errors.New("commit semantic manifest failed")
	}
	committed = true
	// The manifest rename is the commit point. A post-rename directory sync is
	// best effort: reporting failure here would falsely describe a visible new
	// pointer as uncommitted and could trigger an unsafe retry.
	_ = store.syncRoot(root)
	return nil
}

func documentHashes(chunks []retrieval.Chunk) []string {
	byPath := map[string][]string{}
	for _, chunk := range chunks {
		byPath[chunk.Path] = append(byPath[chunk.Path], chunk.ContentHash)
	}
	result := make([]string, 0, len(byPath))
	for path, hashes := range byPath {
		sort.Strings(hashes)
		result = append(result, retrieval.ContentHash(path+"\x00"+strings.Join(hashes, "\x00")))
	}
	sort.Strings(result)
	return result
}
