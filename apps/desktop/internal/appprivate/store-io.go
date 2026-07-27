package appprivate

import (
	"crypto/sha256"
	"errors"
	"io"
	"io/fs"
	"os"
)

// stateVersion is a content-CAS token for cooperating app processes. The
// private directory protection excludes other users; the persistent lock
// serializes every supported writer.
type stateVersion struct {
	digest [sha256.Size]byte
	info   fs.FileInfo
}

func (store *Store) readSnapshot(lease *rootLease) (Snapshot, *stateVersion, error) {
	if err := lease.verify(); err != nil {
		return Snapshot{}, nil, err
	}
	before, err := lease.state.Lstat(store.stateName())
	if errors.Is(err, fs.ErrNotExist) {
		return Snapshot{}, nil, nil
	}
	if err != nil || before.Mode()&fs.ModeSymlink != 0 || !before.Mode().IsRegular() || !privateFileMode(before) {
		return Snapshot{}, nil, ErrUnsafeState
	}
	if before.Size() == 0 {
		return Snapshot{}, nil, ErrInvalidState
	}
	if before.Size() > int64(store.maxBytes) {
		return Snapshot{}, nil, ErrStateTooLarge
	}
	file, err := lease.state.Open(store.stateName())
	if err != nil {
		return Snapshot{}, nil, errors.New("open private state failed")
	}
	defer file.Close()
	store.stateOpenHook()
	opened, err := file.Stat()
	current, currentErr := lease.state.Lstat(store.stateName())
	if err != nil || currentErr != nil || current.Mode()&fs.ModeSymlink != 0 ||
		!current.Mode().IsRegular() || !os.SameFile(before, opened) || !os.SameFile(opened, current) {
		return Snapshot{}, nil, ErrStateChanged
	}
	if err := platformValidateProtectedHandle(file); err != nil {
		return Snapshot{}, nil, ErrUnsafeState
	}
	raw, err := io.ReadAll(&io.LimitedReader{R: file, N: int64(store.maxBytes + 1)})
	if err != nil {
		return Snapshot{}, nil, errors.New("read private state failed")
	}
	if len(raw) == 0 {
		return Snapshot{}, nil, ErrInvalidState
	}
	if len(raw) > store.maxBytes {
		return Snapshot{}, nil, ErrStateTooLarge
	}
	if err := lease.verify(); err != nil {
		return Snapshot{}, nil, err
	}
	return Snapshot{Data: raw, Exists: true}, &stateVersion{
		digest: sha256.Sum256(raw),
		info:   opened,
	}, nil
}

func (store *Store) verifyCurrent(lease *rootLease, expected *stateVersion) error {
	current, err := lease.state.Lstat(store.stateName())
	if expected == nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return errors.New("inspect private state failed")
		}
		return ErrStateChanged
	}
	if err != nil || current.Mode()&fs.ModeSymlink != 0 || !current.Mode().IsRegular() ||
		!os.SameFile(expected.info, current) {
		return ErrStateChanged
	}
	file, err := lease.state.Open(store.stateName())
	if err != nil {
		return ErrStateChanged
	}
	defer file.Close()
	opened, statErr := file.Stat()
	protectionErr := platformValidateProtectedHandle(file)
	raw, readErr := io.ReadAll(&io.LimitedReader{R: file, N: int64(store.maxBytes + 1)})
	if statErr != nil || readErr != nil || !os.SameFile(current, opened) ||
		protectionErr != nil || !privateFileMode(opened) || len(raw) > store.maxBytes ||
		sha256.Sum256(raw) != expected.digest {
		return ErrStateChanged
	}
	return nil
}

func (store *Store) removeState(lease *rootLease, expected *stateVersion) error {
	if expected == nil {
		return nil
	}
	if err := lease.verify(); err != nil {
		return err
	}
	if err := store.verifyCurrent(lease, expected); err != nil {
		return err
	}
	if err := lease.state.Remove(store.stateName()); err != nil {
		return errors.New("remove private state failed")
	}
	if err := lease.verify(); err != nil {
		return err
	}
	_ = syncRootDirectory(lease.state)
	return nil
}
