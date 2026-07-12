package index

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"strings"
)

const (
	maxIndexEntries = MaxIndexChunks + 16
)

func scanIndexEntries(root *os.Root) ([]os.DirEntry, error) {
	directory, err := root.Open(".")
	if err != nil {
		return nil, errors.New("open semantic index directory failed")
	}
	defer directory.Close()
	entries, err := directory.ReadDir(maxIndexEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, errors.New("scan semantic index directory failed")
	}
	if len(entries) > maxIndexEntries {
		return nil, errors.New("semantic index directory exceeds limit")
	}
	return entries, nil
}

func (store *Store) cleanupTemps(root *os.Root) error {
	entries, err := scanIndexEntries(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".index-tmp-") {
			continue
		}
		info, err := entry.Info()
		if err != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("semantic temporary file is unsafe")
		}
		if err := root.Remove(entry.Name()); err != nil {
			return errors.New("semantic temporary cleanup failed")
		}
	}
	return nil
}

func validateIndexEntries(root *os.Root) error {
	entries, err := scanIndexEntries(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if name != manifestName && !generationFileName(name) {
			continue
		}
		info, err := entry.Info()
		if err != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("semantic index file is unsafe")
		}
	}
	return nil
}

func (store *Store) gc(root *os.Root, current, previous string) error {
	entries, err := scanIndexEntries(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if !generationFileName(name) {
			continue
		}
		generation := generationFromName(name)
		if generation == current || generation == previous {
			continue
		}
		info, err := entry.Info()
		if err != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("semantic generation is unsafe")
		}
		if err := root.Remove(name); err != nil {
			return errors.New("semantic generation cleanup failed")
		}
	}
	return store.syncRoot(root)
}

func generationFromName(name string) string {
	if strings.HasPrefix(name, "chunks.") {
		return strings.TrimSuffix(strings.TrimPrefix(name, "chunks."), ".jsonl")
	}
	return strings.TrimSuffix(strings.TrimPrefix(name, "vectors."), ".f32")
}
