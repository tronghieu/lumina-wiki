package workspace

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"unicode/utf8"
)

func openTreeWorkspace(path string) (*os.Root, error) {
	root, err := openTreeRoot(path)
	if err != nil {
		return nil, err
	}
	if err := validateTreeWorkspace(root); err != nil {
		_ = root.Close()
		return nil, err
	}
	return root, nil
}

func openTrustedTreeWorkspace(path string, expected os.FileInfo) (*os.Root, error) {
	root, err := openTreeRoot(path)
	if err != nil {
		return nil, err
	}
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(opened, expected) {
		_ = root.Close()
		return nil, errors.New("workspace root proof changed")
	}
	if err := validateTreeWorkspace(root); err != nil {
		_ = root.Close()
		return nil, err
	}
	return root, nil
}

func openTreeRoot(path string) (*os.Root, error) {
	if path == "" || !utf8.ValidString(path) || !filepath.IsAbs(path) || filepath.Clean(path) != path || len(path) > MaxTreePathBytes {
		return nil, errors.New("canonical absolute workspace root is required")
	}
	before, err := os.Lstat(path)
	if err != nil || !before.IsDir() || before.Mode()&fs.ModeSymlink != 0 {
		return nil, errors.New("workspace root is invalid")
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, errors.New("workspace root cannot be opened")
	}
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		_ = root.Close()
		return nil, errors.New("workspace root changed")
	}
	return root, nil
}

func validateTreeWorkspace(root *os.Root) error {
	readme, err := root.Lstat("README.md")
	if err != nil || !readme.Mode().IsRegular() || readme.Mode()&fs.ModeSymlink != 0 {
		return errors.New("not a Lumina workspace")
	}
	wiki, err := root.Lstat("wiki")
	if err != nil || !wiki.IsDir() || wiki.Mode()&fs.ModeSymlink != 0 {
		return errors.New("not a Lumina workspace")
	}
	return nil
}
