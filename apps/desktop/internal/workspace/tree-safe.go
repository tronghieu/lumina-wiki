package workspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const treeScanBatchSize = 256

type boundedTreeEntry struct {
	entry     os.DirEntry
	directory bool
}

func boundedTreeEntries(ctx context.Context, root *os.Root, directory *os.File, parent string,
	readDir func(*os.File, string, int) ([]os.DirEntry, error)) ([]boundedTreeEntry, bool, bool, error) {
	candidates := make([]boundedTreeEntry, 0, MaxTreeScannedEntries)
	scanned, reachedEOF, invalidEncoding := 0, false, false
	for scanned < MaxTreeScannedEntries {
		if err := ctx.Err(); err != nil {
			return nil, false, invalidEncoding, err
		}
		count := min(treeScanBatchSize, MaxTreeScannedEntries-scanned)
		batch, err := readDir(directory, parent, count)
		if len(batch) > count {
			batch = batch[:count]
		}
		scanned += len(batch)
		if cancelErr := ctx.Err(); cancelErr != nil {
			return nil, false, invalidEncoding, cancelErr
		}
		for _, entry := range batch {
			if cancelErr := ctx.Err(); cancelErr != nil {
				return nil, false, invalidEncoding, cancelErr
			}
			name := entry.Name()
			if !utf8.ValidString(name) {
				invalidEncoding = true
				continue
			}
			if strings.HasPrefix(name, ".") || entry.Type()&fs.ModeSymlink != 0 {
				continue
			}
			path := parent + "/" + name
			info, inspectErr := treeLstat(root, path)
			if inspectErr != nil || (!info.IsDir() && !info.Mode().IsRegular()) {
				continue
			}
			candidates = append(candidates, boundedTreeEntry{entry: entry, directory: info.IsDir()})
		}
		if errors.Is(err, io.EOF) {
			reachedEOF = true
			break
		}
		if err != nil {
			return nil, false, invalidEncoding, err
		}
		if len(batch) == 0 {
			return nil, true, invalidEncoding, nil
		}
	}
	if scanned == MaxTreeScannedEntries && !reachedEOF {
		if err := ctx.Err(); err != nil {
			return nil, false, invalidEncoding, err
		}
		sentinel, err := readDir(directory, parent, 1)
		if cancelErr := ctx.Err(); cancelErr != nil {
			return nil, false, invalidEncoding, cancelErr
		}
		if len(sentinel) > 0 {
			return nil, true, invalidEncoding, nil
		}
		if err != nil && !errors.Is(err, io.EOF) {
			return nil, false, invalidEncoding, err
		}
		if err == nil {
			return nil, true, invalidEncoding, nil
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].directory != candidates[j].directory {
			return candidates[i].directory
		}
		return candidates[i].entry.Name() < candidates[j].entry.Name()
	})
	overflow := len(candidates) > MaxTreeDirEntries
	if len(candidates) > MaxTreeDirEntries {
		candidates = candidates[:MaxTreeDirEntries]
	}
	return candidates, overflow, invalidEncoding, nil
}

func treeID(path string) string {
	sum := sha256.Sum256([]byte("tree-v1\x00" + path))
	return "node_" + hex.EncodeToString(sum[:16])
}

func treeRootCurrent(root *os.Root) bool {
	opened, err := root.Stat(".")
	if err != nil {
		return false
	}
	current, err := os.Stat(root.Name())
	return err == nil && current.IsDir() && os.SameFile(opened, current)
}

func treeLstat(root *os.Root, path string) (os.FileInfo, error) {
	if path == "" || len(path) > MaxTreePathBytes {
		return nil, errors.New("unsafe path")
	}
	for _, part := range strings.Split(path, "/") {
		if part == "" || part == "." || part == ".." || !utf8.ValidString(part) {
			return nil, errors.New("unsafe path")
		}
	}
	if filepath.ToSlash(filepath.Clean(filepath.FromSlash(path))) != path {
		return nil, errors.New("unsafe path")
	}
	current := ""
	parts := strings.Split(path, "/")
	for index, part := range parts {
		if current == "" {
			current = part
		} else {
			current += "/" + part
		}
		info, err := root.Lstat(current)
		if err != nil || info.Mode()&fs.ModeSymlink != 0 {
			return nil, errors.New("unsafe entry")
		}
		if index < len(parts)-1 && !info.IsDir() {
			return nil, errors.New("unsafe entry")
		}
		if index == len(parts)-1 {
			return info, nil
		}
	}
	return nil, errors.New("unsafe path")
}

func treeOpenStable(root *os.Root, path string, directory bool) (*os.File, os.FileInfo, error) {
	before, err := treeLstat(root, path)
	if err != nil || before.IsDir() != directory {
		return nil, nil, errors.New("entry changed")
	}
	file, err := root.Open(path)
	if err != nil {
		return nil, nil, errors.New("entry changed")
	}
	opened, err := file.Stat()
	if err != nil || !os.SameFile(before, opened) || opened.IsDir() != directory {
		_ = file.Close()
		return nil, nil, errors.New("entry changed")
	}
	return file, before, nil
}
