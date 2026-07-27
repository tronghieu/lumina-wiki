package appprivate

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
	"sync/atomic"
)

const (
	tempCreateAttempts  = 8
	maxDirectoryEntries = 256
	maxStaleTemps       = 16
)

var tempSequence atomic.Uint64

func (store *Store) atomicWrite(lease *rootLease, previous fs.FileInfo, raw []byte) error {
	if err := lease.verify(); err != nil {
		return err
	}
	if err := store.verifyCurrent(lease, previous); err != nil {
		return err
	}
	var temp *os.File
	var tempName string
	var err error
	for range tempCreateAttempts {
		tempName = fmt.Sprintf("%s%d-%d", store.tempPrefix(), os.Getpid(), tempSequence.Add(1))
		temp, err = lease.state.OpenFile(tempName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			break
		}
		if !errors.Is(err, fs.ErrExist) {
			break
		}
	}
	if err != nil {
		return errors.New("create private state temporary file failed")
	}
	committed := false
	defer func() {
		_ = temp.Close()
		if !committed {
			_ = lease.state.Remove(tempName)
		}
	}()
	opened, err := temp.Stat()
	current, currentErr := lease.state.Lstat(tempName)
	if err != nil || currentErr != nil || current.Mode()&fs.ModeSymlink != 0 ||
		!current.Mode().IsRegular() || !os.SameFile(opened, current) {
		return ErrStateChanged
	}
	if err := platformProtectHandle(temp, 0o600); err != nil {
		return errors.New("protect private state temporary file failed")
	}
	if err := platformValidateProtectedHandle(temp); err != nil {
		return ErrUnsafeState
	}
	protected, err := temp.Stat()
	if err != nil || !privateFileMode(protected) {
		return ErrUnsafeState
	}
	written, err := temp.Write(raw)
	if err != nil || written != len(raw) {
		if err == nil {
			err = io.ErrShortWrite
		}
		return errors.New("write private state temporary file failed")
	}
	if err := temp.Sync(); err != nil {
		return errors.New("sync private state temporary file failed")
	}
	if err := lease.verify(); err != nil {
		return err
	}
	store.beforeCommitHook()
	if err := store.verifyCurrent(lease, previous); err != nil {
		return err
	}
	if err := temp.Close(); err != nil {
		return errors.New("close private state temporary file failed")
	}
	if err := store.renameRoot(lease.state, tempName, store.stateName()); err != nil {
		return errors.New("commit private state failed")
	}
	committed = true
	finalInfo, err := lease.state.Lstat(store.stateName())
	if err != nil || finalInfo.Mode()&fs.ModeSymlink != 0 || !finalInfo.Mode().IsRegular() ||
		!os.SameFile(protected, finalInfo) {
		return ErrStateChanged
	}
	final, err := lease.state.Open(store.stateName())
	if err != nil {
		return errors.New("verify committed private state failed")
	}
	finalOpened, statErr := final.Stat()
	protectErr := platformValidateProtectedHandle(final)
	_ = final.Close()
	if statErr != nil || protectErr != nil || !os.SameFile(finalInfo, finalOpened) || !privateFileMode(finalOpened) {
		return ErrUnsafeState
	}
	if err := lease.verify(); err != nil {
		return err
	}
	if err := store.syncRoot(lease.state); err != nil {
		return errors.New("committed private state durability is uncertain")
	}
	return nil
}

func (store *Store) cleanupTemps(lease *rootLease) error {
	directory, err := lease.state.Open(".")
	if err != nil {
		return errors.New("open private state directory failed")
	}
	defer directory.Close()
	entries, err := directory.ReadDir(maxDirectoryEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return errors.New("scan private state directory failed")
	}
	if len(entries) > maxDirectoryEntries {
		return errors.New("private state directory exceeds entry limit")
	}
	count := 0
	var total int64
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), store.tempPrefix()) {
			continue
		}
		info, err := entry.Info()
		if err != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() ||
			!privateFileMode(info) {
			return ErrUnsafeState
		}
		count++
		total += info.Size()
		if count > maxStaleTemps || total > int64(store.maxBytes*maxStaleTemps) {
			return errors.New("private state maintenance required")
		}
		file, err := lease.state.Open(entry.Name())
		if err != nil {
			return errors.New("open private state temporary file failed")
		}
		opened, statErr := file.Stat()
		protectionErr := platformValidateProtectedHandle(file)
		_ = file.Close()
		current, currentErr := lease.state.Lstat(entry.Name())
		if statErr != nil || protectionErr != nil || currentErr != nil ||
			current.Mode()&fs.ModeSymlink != 0 || !current.Mode().IsRegular() ||
			!os.SameFile(info, opened) || !os.SameFile(opened, current) {
			return ErrUnsafeState
		}
		if err := lease.state.Remove(entry.Name()); err != nil {
			return errors.New("private state maintenance failed")
		}
	}
	return lease.verify()
}

func syncRootDirectory(root *os.Root) error {
	directory, err := root.Open(".")
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
