package appprivate

import (
	"errors"
	"io/fs"
	"os"
)

type rootLease struct {
	store             *Store
	base, app, state  *os.Root
	baseInfo, appInfo fs.FileInfo
	stateInfo         fs.FileInfo
}

func (store *Store) openRoots() (*rootLease, error) {
	baseInfo, err := os.Lstat(store.baseDir)
	if err != nil || baseInfo.Mode()&fs.ModeSymlink != 0 || !baseInfo.IsDir() {
		return nil, ErrUnsafeState
	}
	base, err := os.OpenRoot(store.baseDir)
	if err != nil {
		return nil, errors.New("open private state base failed")
	}
	openedBase, err := base.Stat(".")
	if err != nil || !os.SameFile(baseInfo, openedBase) {
		base.Close()
		return nil, ErrStateChanged
	}
	app, appInfo, err := store.openVerifiedChild(base, appDirectoryName, store.appDirOpenHook)
	if err != nil {
		base.Close()
		return nil, err
	}
	state, stateInfo, err := store.openVerifiedChild(app, stateDirectoryName, store.stateDirOpenHook)
	if err != nil {
		app.Close()
		base.Close()
		return nil, err
	}
	lease := &rootLease{store: store, base: base, app: app, state: state,
		baseInfo: openedBase, appInfo: appInfo, stateInfo: stateInfo}
	if err := lease.verify(); err != nil {
		lease.close()
		return nil, err
	}
	return lease, nil
}

func (store *Store) openVerifiedChild(parent *os.Root, name string, beforeOpen func()) (*os.Root, fs.FileInfo, error) {
	expected, err := parent.Lstat(name)
	created := false
	if errors.Is(err, fs.ErrNotExist) {
		if err := parent.Mkdir(name, 0o700); err != nil && !errors.Is(err, fs.ErrExist) {
			return nil, nil, errors.New("create private state directory failed")
		} else if err == nil {
			created = true
		}
		expected, err = parent.Lstat(name)
	}
	if err != nil || expected.Mode()&fs.ModeSymlink != 0 || !expected.IsDir() {
		return nil, nil, ErrUnsafeState
	}
	beforeOpen()
	child, err := parent.OpenRoot(name)
	if err != nil {
		return nil, nil, errors.New("open private state directory failed")
	}
	opened, statErr := child.Stat(".")
	if statErr != nil || !os.SameFile(expected, opened) {
		child.Close()
		return nil, nil, ErrStateChanged
	}
	handle, err := child.Open(".")
	if err != nil {
		child.Close()
		return nil, nil, errors.New("open private state directory handle failed")
	}
	defer handle.Close()
	handleInfo, statErr := handle.Stat()
	if statErr != nil || !os.SameFile(opened, handleInfo) {
		child.Close()
		return nil, nil, ErrStateChanged
	}
	if err := platformProtectHandle(handle, 0o700); err != nil {
		child.Close()
		return nil, nil, errors.New("protect private state directory failed")
	}
	if err := platformValidateProtectedHandle(handle); err != nil {
		child.Close()
		return nil, nil, ErrUnsafeState
	}
	protected, err := handle.Stat()
	if err != nil || !privateDirectoryMode(protected) {
		child.Close()
		return nil, nil, ErrUnsafeState
	}
	if created {
		_ = syncRootDirectory(parent)
	}
	return child, protected, nil
}

func (lease *rootLease) verify() error {
	currentBase, err := os.Lstat(lease.store.baseDir)
	openedBase, statErr := lease.base.Stat(".")
	if err != nil || statErr != nil || currentBase.Mode()&fs.ModeSymlink != 0 || !currentBase.IsDir() ||
		!os.SameFile(lease.baseInfo, currentBase) || !os.SameFile(currentBase, openedBase) {
		return ErrStateChanged
	}
	currentApp, err := lease.base.Lstat(appDirectoryName)
	openedApp, statErr := lease.app.Stat(".")
	if err != nil || statErr != nil || currentApp.Mode()&fs.ModeSymlink != 0 || !currentApp.IsDir() ||
		!os.SameFile(lease.appInfo, currentApp) || !os.SameFile(currentApp, openedApp) {
		return ErrStateChanged
	}
	currentState, err := lease.app.Lstat(stateDirectoryName)
	openedState, statErr := lease.state.Stat(".")
	if err != nil || statErr != nil || currentState.Mode()&fs.ModeSymlink != 0 || !currentState.IsDir() ||
		!os.SameFile(lease.stateInfo, currentState) || !os.SameFile(currentState, openedState) {
		return ErrStateChanged
	}
	return nil
}

func (lease *rootLease) close() {
	_ = lease.state.Close()
	_ = lease.app.Close()
	_ = lease.base.Close()
}
