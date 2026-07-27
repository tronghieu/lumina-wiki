package index

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"sync"
	"time"
)

func (store *Store) acquireLock(ctx context.Context, root *os.Root) (func(), error) {
	return store.acquireLockFile(ctx, root, true)
}

func (store *Store) acquireReadLock(ctx context.Context, root *os.Root) (func(), error) {
	return store.acquireLockFile(ctx, root, false)
}

func (store *Store) acquireLockFile(ctx context.Context, root *os.Root, writable bool) (func(), error) {
	if info, err := root.Lstat(lockName); err == nil {
		if info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() || !privateIndexFile(info) {
			return nil, errors.New("semantic index lock is unsafe")
		}
	} else if errors.Is(err, fs.ErrNotExist) && !writable {
		return nil, errors.New("semantic index lock is unavailable")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, errors.New("inspect semantic index lock failed")
	}
	flags := os.O_RDONLY
	if writable {
		flags = os.O_RDWR | os.O_CREATE
	}
	file, err := store.openLock(root, lockName, flags, 0o600)
	if err != nil {
		return nil, errors.New("open semantic index lock failed")
	}
	opened, statErr := file.Stat()
	current, lstatErr := root.Lstat(lockName)
	if statErr != nil || lstatErr != nil || current.Mode()&fs.ModeSymlink != 0 || !opened.Mode().IsRegular() || !os.SameFile(opened, current) ||
		writable && store.protect(file, 0o600) != nil || !writable && store.validate(file) != nil {
		file.Close()
		return nil, errors.New("semantic index lock changed")
	}
	for {
		if err := ctx.Err(); err != nil {
			file.Close()
			return nil, err
		}
		busy, err := platformTryIndexLock(file, writable)
		if err != nil {
			file.Close()
			return nil, errors.New("semantic index lock failed")
		}
		if !busy {
			var once sync.Once
			return func() { once.Do(func() { _ = platformUnlockIndex(file); _ = file.Close() }) }, nil
		}
		select {
		case <-ctx.Done():
			file.Close()
			return nil, ctx.Err()
		case <-time.After(5 * time.Millisecond):
		}
	}
}
