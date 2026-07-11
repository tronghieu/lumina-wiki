package history

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"sync"
	"time"
)

func (store *HistoryStore) acquireAdvisoryRoot(ctx context.Context, root *os.Root) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	store.ioHook()
	locksRoot, err := store.openVerifiedChild(root, "locks", store.locksOpenHook)
	if err != nil {
		return nil, errors.New("open history lock directory failed")
	}
	defer locksRoot.Close()
	name := store.workspaceID + ".lock"
	if info, err := locksRoot.Lstat(name); err == nil {
		if info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil, errors.New("history lock is invalid")
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, errors.New("inspect history lock failed")
	}
	file, err := locksRoot.OpenFile(name, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, errors.New("open history lock failed")
	}
	opened, statErr := file.Stat()
	current, lstatErr := locksRoot.Lstat(name)
	if statErr != nil || lstatErr != nil || current.Mode()&fs.ModeSymlink != 0 || !opened.Mode().IsRegular() || !os.SameFile(opened, current) {
		_ = file.Close()
		return nil, errors.New("history lock changed while opening")
	}
	if store.protectHandle(file, 0o600) != nil {
		_ = file.Close()
		return nil, errors.New("secure history lock failed")
	}
	for {
		if err := ctx.Err(); err != nil {
			_ = file.Close()
			return nil, err
		}
		busy, err := platformTryLock(file)
		if err != nil {
			_ = file.Close()
			return nil, errors.New("history lock failed")
		}
		if !busy {
			var once sync.Once
			return func() { once.Do(func() { _ = platformUnlock(file); _ = file.Close() }) }, nil
		}
		select {
		case <-ctx.Done():
			_ = file.Close()
			return nil, ctx.Err()
		case <-time.After(5 * time.Millisecond):
		}
	}
}

func (store *HistoryStore) acquireAdvisory(ctx context.Context) (func(), error) {
	root, err := store.openHistoryRoot()
	if err != nil {
		return nil, err
	}
	release, err := store.acquireAdvisoryRoot(ctx, root)
	if err != nil {
		_ = root.Close()
		return nil, err
	}
	return func() { release(); _ = root.Close() }, nil
}
