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
	if info, err := root.Lstat(lockName); err == nil {
		if info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil, errors.New("semantic index lock is unsafe")
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, errors.New("inspect semantic index lock failed")
	}
	file, err := root.OpenFile(lockName, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, errors.New("open semantic index lock failed")
	}
	opened, statErr := file.Stat()
	current, lstatErr := root.Lstat(lockName)
	if statErr != nil || lstatErr != nil || current.Mode()&fs.ModeSymlink != 0 || !opened.Mode().IsRegular() || !os.SameFile(opened, current) || store.protect(file, 0o600) != nil {
		file.Close()
		return nil, errors.New("semantic index lock changed")
	}
	for {
		if err := ctx.Err(); err != nil {
			file.Close()
			return nil, err
		}
		busy, err := platformTryIndexLock(file)
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
