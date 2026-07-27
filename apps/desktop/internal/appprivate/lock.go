package appprivate

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"sync"
	"time"
)

func (store *Store) acquire(ctx context.Context) (func(), error) {
	_, release, err := store.acquireLease(ctx)
	return release, err
}

func (store *Store) acquireLease(ctx context.Context) (*rootLease, func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	lease, err := store.openRoots()
	if err != nil {
		return nil, nil, err
	}
	releaseLock, err := store.acquireLock(ctx, lease)
	if err != nil {
		lease.close()
		return nil, nil, err
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			releaseLock()
			lease.close()
		})
	}
	return lease, release, nil
}

func (store *Store) acquireLock(ctx context.Context, lease *rootLease) (func(), error) {
	if err := lease.verify(); err != nil {
		return nil, err
	}
	var file *os.File
	var created bool
	for range 4 {
		info, err := lease.state.Lstat(store.lockName())
		switch {
		case errors.Is(err, fs.ErrNotExist):
			file, err = lease.state.OpenFile(store.lockName(), os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
			if errors.Is(err, fs.ErrExist) {
				continue
			}
			created = err == nil
		case err != nil:
			return nil, errors.New("inspect private state lock failed")
		case info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular():
			return nil, ErrUnsafeState
		default:
			file, err = lease.state.OpenFile(store.lockName(), os.O_RDWR, 0o600)
		}
		if err != nil {
			return nil, errors.New("open private state lock failed")
		}
		break
	}
	if file == nil {
		return nil, errors.New("open private state lock failed")
	}
	opened, statErr := file.Stat()
	current, lstatErr := lease.state.Lstat(store.lockName())
	if statErr != nil || lstatErr != nil || current.Mode()&fs.ModeSymlink != 0 ||
		!opened.Mode().IsRegular() || !current.Mode().IsRegular() || !os.SameFile(opened, current) {
		file.Close()
		return nil, ErrStateChanged
	}
	if created {
		store.lockCreatedHook()
	}
	for {
		if err := ctx.Err(); err != nil {
			file.Close()
			return nil, err
		}
		busy, err := platformTryLock(file)
		if err != nil {
			file.Close()
			if errors.Is(err, ErrLockUnsupported) {
				return nil, ErrLockUnsupported
			}
			return nil, errors.New("lock private state failed")
		}
		if !busy {
			break
		}
		select {
		case <-ctx.Done():
			file.Close()
			return nil, ctx.Err()
		case <-time.After(5 * time.Millisecond):
		}
	}
	if created || platformRepairsExistingLockProtection() {
		if err := platformProtectHandle(file, 0o600); err != nil {
			_ = platformUnlock(file)
			file.Close()
			return nil, errors.New("protect private state lock failed")
		}
	}
	if err := platformValidateProtectedHandle(file); err != nil {
		_ = platformUnlock(file)
		file.Close()
		return nil, ErrUnsafeState
	}
	protected, err := file.Stat()
	if err != nil || !privateFileMode(protected) {
		_ = platformUnlock(file)
		file.Close()
		return nil, ErrUnsafeState
	}
	if created {
		_ = syncRootDirectory(lease.state)
	}
	current, lstatErr = lease.state.Lstat(store.lockName())
	if lstatErr != nil || current.Mode()&fs.ModeSymlink != 0 || !os.SameFile(protected, current) {
		_ = platformUnlock(file)
		file.Close()
		return nil, ErrStateChanged
	}
	if err := lease.verify(); err != nil {
		_ = platformUnlock(file)
		file.Close()
		return nil, err
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			_ = platformUnlock(file)
			_ = file.Close()
		})
	}, nil
}
