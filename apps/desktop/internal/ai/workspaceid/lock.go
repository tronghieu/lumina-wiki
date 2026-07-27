package workspaceid

import (
	"errors"
	"io/fs"
	"os"
	"sync"
)

func (store *registryStore) acquireLock() (func(), error) {
	if _, err := store.ensureDir(true); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(store.lockPath); err == nil {
		if info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil, errors.New("registry lock must be a regular file")
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, errors.New("inspect registry lock failed")
	}
	file, err := os.OpenFile(store.lockPath, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, errors.New("open registry lock failed")
	}
	opened, statErr := file.Stat()
	current, lstatErr := os.Lstat(store.lockPath)
	if statErr != nil || lstatErr != nil || current.Mode()&fs.ModeSymlink != 0 ||
		!opened.Mode().IsRegular() || !current.Mode().IsRegular() ||
		!os.SameFile(opened, current) {
		_ = file.Close()
		return nil, errors.New("registry lock changed while opening")
	}
	if err := store.secureLockMode(file); err != nil {
		_ = file.Close()
		return nil, errors.New("secure registry lock permissions failed")
	}
	secured, err := file.Stat()
	if err != nil || !privateFileMode(secured) {
		_ = file.Close()
		return nil, errors.New("registry lock permissions are not private")
	}
	if err := store.tryLock(file); err != nil {
		_ = file.Close()
		if errors.Is(err, ErrRegistryBusy) {
			return nil, ErrRegistryBusy
		}
		return nil, errors.New("kernel registry lock failed")
	}
	var once sync.Once
	return func() { once.Do(func() { _ = store.unlock(file); _ = file.Close() }) }, nil
}
