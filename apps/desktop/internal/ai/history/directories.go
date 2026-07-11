package history

import (
	"errors"
	"io/fs"
	"os"
)

func (store *HistoryStore) openHistoryRoot() (*os.Root, error) {
	base, err := os.OpenRoot(store.baseDir)
	if err != nil {
		return nil, errors.New("open trusted history base failed")
	}
	defer base.Close()
	desktop, err := store.openVerifiedChild(base, ownedLeaf, store.desktopOpenHook)
	if err != nil {
		return nil, err
	}
	defer desktop.Close()
	history, err := store.openVerifiedChild(desktop, historyLeaf, store.historyOpenHook)
	if err != nil {
		return nil, err
	}
	return history, nil
}

func (store *HistoryStore) openWorkspace(root *os.Root) (*os.Root, error) {
	workspace, err := store.openVerifiedChild(root, store.workspaceID, store.workspaceOpenHook)
	if err != nil {
		return nil, errors.New("workspace history directory is invalid")
	}
	return workspace, nil
}

func (store *HistoryStore) openVerifiedChild(parent *os.Root, name string, beforeOpen func()) (*os.Root, error) {
	expected, err := parent.Lstat(name)
	if errors.Is(err, fs.ErrNotExist) {
		if mkdirErr := parent.Mkdir(name, 0o700); mkdirErr != nil && !errors.Is(mkdirErr, fs.ErrExist) {
			return nil, errors.New("create owned history directory failed")
		}
		expected, err = parent.Lstat(name)
	}
	if err != nil || expected.Mode()&fs.ModeSymlink != 0 || !expected.IsDir() {
		return nil, errors.New("owned history directory is invalid")
	}
	beforeOpen()
	child, err := parent.OpenRoot(name)
	if err != nil {
		return nil, errors.New("open owned history directory failed")
	}
	opened, statErr := child.Stat(".")
	if statErr != nil || !os.SameFile(expected, opened) {
		_ = child.Close()
		return nil, errors.New("owned history directory changed while opening")
	}
	handle, err := child.Open(".")
	if err != nil {
		_ = child.Close()
		return nil, errors.New("open owned history handle failed")
	}
	handleInfo, statErr := handle.Stat()
	if statErr != nil || !os.SameFile(expected, handleInfo) {
		_ = handle.Close()
		_ = child.Close()
		return nil, errors.New("owned history handle identity changed")
	}
	if store.protectHandle(handle, 0o700) != nil {
		_ = handle.Close()
		_ = child.Close()
		return nil, errors.New("protect owned history directory failed")
	}
	_ = handle.Close()
	return child, nil
}

func (store *HistoryStore) ensureDirs(bool) (bool, error) {
	root, err := store.openHistoryRoot()
	if err != nil {
		return false, err
	}
	defer root.Close()
	workspace, err := store.openWorkspace(root)
	if err != nil {
		return false, err
	}
	_ = workspace.Close()
	return true, nil
}
