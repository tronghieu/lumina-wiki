package index

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"strings"
)

func (store *Store) clearFiles(ctx context.Context, root *os.Root) error {
	entries, err := scanIndexEntries(root)
	if err != nil {
		return err
	}
	owned := make(map[string]os.FileInfo)
	var manifest os.FileInfo
	for _, entry := range entries {
		name := entry.Name()
		if name != manifestName && !generationFileName(name) && !strings.HasPrefix(name, ".index-tmp-") {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("semantic index file is unsafe")
		}
		owned[name] = info
		if name == manifestName {
			manifest = info
		}
	}
	clearName := ""
	if manifest != nil {
		generation, err := randomGeneration()
		if err != nil {
			return err
		}
		clearName = ".index-tmp-clear-" + generation
		if _, err := root.Lstat(clearName); !errors.Is(err, fs.ErrNotExist) {
			return errors.New("clear temporary file exists")
		}
		current, err := root.Lstat(manifestName)
		if err != nil || !os.SameFile(manifest, current) {
			return errors.New("semantic manifest changed")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := store.rename(root, manifestName, clearName); err != nil {
			return errors.New("clear semantic manifest failed")
		}
		owned[clearName] = manifest
		delete(owned, manifestName)
	}
	// Pointer absence is the commit point. Everything below is best effort and
	// cannot turn a visible empty state into a reported pre-commit failure.
	_ = store.syncRoot(root)
	for name, expected := range owned {
		current, statErr := root.Lstat(name)
		if statErr == nil && os.SameFile(expected, current) {
			_ = store.remove(root, name)
		}
	}
	_ = store.syncRoot(root)
	return nil
}

func generationFileName(name string) bool {
	for _, shape := range []struct{ prefix, suffix string }{{"chunks.", ".jsonl"}, {"vectors.", ".f32"}} {
		if strings.HasPrefix(name, shape.prefix) && strings.HasSuffix(name, shape.suffix) {
			id := strings.TrimSuffix(strings.TrimPrefix(name, shape.prefix), shape.suffix)
			return lowerHex32.MatchString(id)
		}
	}
	return false
}
