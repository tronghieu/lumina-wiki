package workspaceid

import (
	"errors"
	"io"
	"io/fs"
	"os"
)

func (store *registryStore) readBounded() ([]byte, bool, error) {
	before, err := os.Lstat(store.path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, true, nil
	}
	if err != nil {
		return nil, false, errors.New("inspect registry file failed")
	}
	if before.Mode()&fs.ModeSymlink != 0 || !before.Mode().IsRegular() {
		return nil, false, errors.New("registry file must be a regular file")
	}
	if !privateFileMode(before) {
		return nil, false, errors.New("registry file permissions must be private")
	}
	if before.Size() > MaxRegistryBytes {
		return nil, false, errors.New("workspace registry exceeds size limit")
	}
	file, err := os.Open(store.path)
	if err != nil {
		return nil, false, errors.New("open registry file failed")
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return nil, false, ErrRegistryConflict
	}
	limited := &io.LimitedReader{R: file, N: MaxRegistryBytes + 1}
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, false, errors.New("read registry file failed")
	}
	if len(raw) > MaxRegistryBytes {
		return nil, false, errors.New("workspace registry exceeds size limit")
	}
	return raw, false, nil
}

func (store *registryStore) atomicWrite(raw []byte) error {
	temp, err := os.CreateTemp(store.dir, "."+registryFileName+".tmp-")
	if err != nil {
		return errors.New("create registry temporary file failed")
	}
	tempPath := temp.Name()
	committed := false
	defer func() {
		_ = temp.Close()
		if !committed {
			_ = os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(0o600); err != nil {
		return errors.New("secure registry temporary file failed")
	}
	if _, err := temp.Write(raw); err != nil {
		return errors.New("write registry temporary file failed")
	}
	if err := temp.Sync(); err != nil {
		return errors.New("sync registry temporary file failed")
	}
	if err := temp.Close(); err != nil {
		return errors.New("close registry temporary file failed")
	}
	if err := store.rename(tempPath, store.path); err != nil {
		return errors.New("commit registry failed")
	}
	committed = true
	// The file sync and rename above are mandatory. Directory sync is only a
	// durability enhancement and is best-effort because some supported filesystems
	// reject directory fsync; after rename, reporting failure would imply rollback.
	_ = store.syncDir(store.dir)
	return nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
