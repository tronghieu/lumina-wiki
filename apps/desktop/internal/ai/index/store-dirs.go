package index

import (
	"errors"
	"io/fs"
	"os"
)

func (store *Store) openRoot() (*os.Root, error) {
	base, err := os.OpenRoot(store.baseDir)
	if err != nil {
		return nil, errors.New("open semantic index cache failed")
	}
	defer base.Close()
	opened, err := base.Stat(".")
	current, currentErr := os.Lstat(store.baseDir)
	if err != nil || currentErr != nil || !os.SameFile(store.baseIdentity, opened) || !os.SameFile(store.baseIdentity, current) {
		return nil, errors.New("semantic index cache base changed")
	}
	desktop, err := store.openChild(base, ownedCacheLeaf, &store.desktopIdentity)
	if err != nil {
		return nil, err
	}
	defer desktop.Close()
	indexes, err := store.openChild(desktop, indexesLeaf, &store.indexesIdentity)
	if err != nil {
		return nil, err
	}
	defer indexes.Close()
	return store.openChild(indexes, store.workspaceID, &store.workspaceIdentity)
}

func (store *Store) openRootReadOnly() (*os.Root, error) {
	base, err := os.OpenRoot(store.baseDir)
	if err != nil {
		return nil, errors.New("open semantic index cache failed")
	}
	defer base.Close()
	opened, err := base.Stat(".")
	current, currentErr := os.Lstat(store.baseDir)
	if err != nil || currentErr != nil || !os.SameFile(store.baseIdentity, opened) || !os.SameFile(store.baseIdentity, current) {
		return nil, errors.New("semantic index cache base changed")
	}
	desktop, err := store.openExistingChild(base, ownedCacheLeaf, store.desktopIdentity)
	if err != nil {
		return nil, err
	}
	defer desktop.Close()
	indexes, err := store.openExistingChild(desktop, indexesLeaf, store.indexesIdentity)
	if err != nil {
		return nil, err
	}
	defer indexes.Close()
	return store.openExistingChild(indexes, store.workspaceID, store.workspaceIdentity)
}

func (store *Store) openExistingChild(parent *os.Root, name string, expected os.FileInfo) (*os.Root, error) {
	current, err := parent.Lstat(name)
	if err != nil || expected == nil || current.Mode()&fs.ModeSymlink != 0 || !current.IsDir() ||
		!privateIndexDirectory(current) || !os.SameFile(expected, current) {
		return nil, errors.New("semantic index directory changed")
	}
	child, err := parent.OpenRoot(name)
	if err != nil {
		return nil, errors.New("open semantic index directory failed")
	}
	opened, statErr := child.Stat(".")
	if statErr != nil || !os.SameFile(current, opened) {
		child.Close()
		return nil, errors.New("semantic index directory changed")
	}
	return child, nil
}

func (store *Store) openChild(parent *os.Root, name string, pinned *os.FileInfo) (*os.Root, error) {
	expected, err := parent.Lstat(name)
	created := false
	if errors.Is(err, fs.ErrNotExist) {
		if err = parent.Mkdir(name, 0o700); err != nil && !errors.Is(err, fs.ErrExist) {
			return nil, errors.New("create semantic index directory failed")
		}
		created = err == nil
		expected, err = parent.Lstat(name)
	}
	if err != nil || expected.Mode()&fs.ModeSymlink != 0 || !expected.IsDir() {
		return nil, errors.New("semantic index directory is unsafe")
	}
	if !created && !privateIndexDirectory(expected) {
		return nil, errors.New("semantic index directory permissions are unsafe")
	}
	store.identityMu.Lock()
	if *pinned != nil && !os.SameFile(*pinned, expected) {
		store.identityMu.Unlock()
		return nil, errors.New("semantic index directory changed")
	}
	store.identityMu.Unlock()
	child, err := parent.OpenRoot(name)
	if err != nil {
		return nil, errors.New("open semantic index directory failed")
	}
	opened, statErr := child.Stat(".")
	if statErr != nil || !os.SameFile(expected, opened) {
		child.Close()
		return nil, errors.New("semantic index directory changed")
	}
	handle, err := child.Open(".")
	if err != nil || store.protect(handle, 0o700) != nil {
		if handle != nil {
			handle.Close()
		}
		child.Close()
		return nil, errors.New("protect semantic index directory failed")
	}
	handle.Close()
	store.identityMu.Lock()
	if *pinned == nil {
		*pinned = expected
	} else if !os.SameFile(*pinned, expected) {
		store.identityMu.Unlock()
		child.Close()
		return nil, errors.New("semantic index directory changed")
	}
	store.identityMu.Unlock()
	return child, nil
}
