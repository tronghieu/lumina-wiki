package workspaceid

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

const (
	ownedConfigLeaf  = "lumina-wiki-desktop"
	registryFileName = "workspace-registry.json"
	registryLockName = "workspace-registry.lock"
)

type registryStore struct {
	dir, path, lockPath string
	rename              func(string, string) error
	syncDir             func(string) error
	mkdir               func(string, fs.FileMode) error
	tryLock             func(*os.File) error
	unlock              func(*os.File) error
	secureLockMode      func(*os.File) error
}

func newRegistryStore(base string) (*registryStore, error) {
	if base == "" || !filepath.IsAbs(base) {
		return nil, errors.New("absolute config base directory is required")
	}
	dir := filepath.Join(filepath.Clean(base), ownedConfigLeaf)
	return &registryStore{dir: dir, path: filepath.Join(dir, registryFileName),
		lockPath: filepath.Join(dir, registryLockName), rename: os.Rename,
		syncDir: syncDirectory, mkdir: os.Mkdir, tryLock: platformTryLock, unlock: platformUnlock,
		secureLockMode: platformSecureLockMode}, nil
}

func (store *registryStore) ensureDir(create bool) (bool, error) {
	info, err := os.Lstat(store.dir)
	lostCreationRace := false
	if errors.Is(err, fs.ErrNotExist) {
		if !create {
			return false, nil
		}
		if err := store.mkdir(store.dir, 0o700); err != nil && !errors.Is(err, fs.ErrExist) {
			return false, errors.New("create registry directory failed")
		} else if errors.Is(err, fs.ErrExist) {
			lostCreationRace = true
		}
		info, err = os.Lstat(store.dir)
	}
	if err != nil {
		return false, errors.New("open registry directory failed")
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		return false, errors.New("registry directory must be a real directory")
	}
	if lostCreationRace && !privateDirectoryMode(info) {
		return false, errors.New("registry directory permissions must be private")
	}
	if !create && !privateDirectoryMode(info) {
		return false, errors.New("registry directory permissions must be private")
	}
	if create {
		if err := os.Chmod(store.dir, 0o700); err != nil {
			return false, errors.New("secure registry directory failed")
		}
	}
	return true, nil
}

func (store *registryStore) Load() (Registry, error) {
	registry, _, err := store.LoadSnapshot()
	return registry, err
}

func (store *registryStore) LoadSnapshot() (Registry, string, error) {
	exists, err := store.ensureDir(false)
	if err != nil {
		return Registry{}, "", err
	}
	if !exists {
		return emptyRegistrySnapshot()
	}
	raw, missing, err := store.readBounded()
	if err != nil {
		return Registry{}, "", err
	}
	if missing {
		return emptyRegistrySnapshot()
	}
	registry, err := decodeRegistry(raw)
	if err != nil {
		return Registry{}, "", err
	}
	return registry, registryRevision(raw), nil
}

func emptyRegistrySnapshot() (Registry, string, error) {
	registry := emptyRegistry()
	raw, err := encodeRegistry(registry)
	if err != nil {
		return Registry{}, "", err
	}
	return registry, registryRevision(raw), nil
}

func (store *registryStore) Save(registry Registry) error {
	if err := registry.validateContent(false); err != nil {
		return err
	}
	registry, raw, err := fitRegistryToBudget(registry)
	if err != nil {
		return err
	}
	if err := registry.validate(); err != nil {
		return err
	}
	if _, err := store.ensureDir(true); err != nil {
		return err
	}
	if info, err := os.Lstat(store.path); err == nil {
		if info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("registry file must be a regular file")
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return errors.New("inspect registry file failed")
	}
	return store.atomicWrite(raw)
}
