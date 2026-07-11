package retrieval

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

type entryClass uint8

const (
	entryOK entryClass = iota
	entryChanged
	entryUnsafe
	entryUnreadable
)

var errChanged = errors.New("entry changed")

func openWorkspace(rootPath string) (*os.Root, error) {
	if rootPath == "" || !utf8.ValidString(rootPath) || !filepath.IsAbs(rootPath) || filepath.Clean(rootPath) != rootPath || len(rootPath) > MaxRelativePathBytes {
		return nil, errors.New("canonical absolute workspace root is required")
	}
	before, err := os.Lstat(rootPath)
	if err != nil || !before.IsDir() || before.Mode()&fs.ModeSymlink != 0 {
		return nil, errors.New("workspace root is invalid")
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, errors.New("workspace root cannot be opened")
	}
	valid := false
	defer func() {
		if !valid {
			_ = root.Close()
		}
	}()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		return nil, errChanged
	}
	readme, err := root.Lstat("README.md")
	if err != nil || !readme.Mode().IsRegular() || readme.Mode()&fs.ModeSymlink != 0 {
		return nil, errors.New("not a Lumina workspace")
	}
	wiki, err := root.Lstat("wiki")
	if err != nil || !wiki.IsDir() || wiki.Mode()&fs.ModeSymlink != 0 {
		return nil, errors.New("not a Lumina workspace")
	}
	valid = true
	return root, nil
}

func lstatReal(root *os.Root, name string) (os.FileInfo, error) {
	info, class := inspectReal(root, name)
	if class != entryOK {
		return nil, errChanged
	}
	return info, nil
}

func inspectReal(root *os.Root, name string) (os.FileInfo, entryClass) {
	if name == "" || len(name) > MaxRelativePathBytes {
		return nil, entryUnsafe
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || !utf8.ValidString(part) {
			return nil, entryUnsafe
		}
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(name)))
	if clean != name || clean == "." || strings.HasPrefix(clean, "../") {
		return nil, entryUnsafe
	}
	current := ""
	parts := strings.Split(name, "/")
	for index, part := range parts {
		if part == "" || part == "." || part == ".." || !utf8.ValidString(part) {
			return nil, entryUnsafe
		}
		if current == "" {
			current = part
		} else {
			current += "/" + part
		}
		info, err := root.Lstat(current)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil, entryChanged
			}
			return nil, entryUnreadable
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			return nil, entryUnsafe
		}
		if index < len(parts)-1 && !info.IsDir() {
			return nil, entryUnsafe
		}
		if index == len(parts)-1 {
			return info, entryOK
		}
	}
	return nil, entryUnsafe
}

func (corpus *Corpus) openStable(root *os.Root, name string, directory bool) (*os.File, os.FileInfo, entryClass) {
	before, class := inspectReal(root, name)
	if class != entryOK {
		return nil, nil, class
	}
	if before.IsDir() != directory {
		return nil, nil, entryChanged
	}
	file, err := corpus.openFile(root, name)
	if err != nil {
		current, currentClass := inspectReal(root, name)
		if errors.Is(err, fs.ErrNotExist) || currentClass == entryChanged || currentClass == entryUnsafe || (current != nil && !os.SameFile(before, current)) {
			return nil, nil, entryChanged
		}
		return nil, nil, entryUnreadable
	}
	opened, err := file.Stat()
	if err != nil {
		_ = file.Close()
		current, currentClass := inspectReal(root, name)
		if currentClass != entryOK || (current != nil && !os.SameFile(before, current)) {
			return nil, nil, entryChanged
		}
		return nil, nil, entryUnreadable
	}
	if !os.SameFile(before, opened) || opened.IsDir() != directory {
		_ = file.Close()
		return nil, nil, entryChanged
	}
	return file, before, entryOK
}
