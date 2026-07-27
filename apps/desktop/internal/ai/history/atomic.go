package history

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
)

const tempFilePrefix = ".history-tmp-"

var tempSequence atomic.Uint64

func (store *HistoryStore) atomicWrite(root *os.Root, name string, raw []byte) error {
	var temp *os.File
	var tempName string
	var err error
	for range 8 {
		tempName = fmt.Sprintf("%s%d-%d", tempFilePrefix, os.Getpid(), tempSequence.Add(1))
		temp, err = root.OpenFile(tempName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			break
		}
	}
	if err != nil {
		return errors.New("create history temporary file failed")
	}
	committed := false
	defer func() {
		_ = temp.Close()
		if !committed {
			_ = root.Remove(tempName)
		}
	}()
	if store.protectHandle(temp, 0o600) != nil {
		return errors.New("secure history temporary file failed")
	}
	if _, err := temp.Write(raw); err != nil {
		return errors.New("write history temporary file failed")
	}
	if temp.Sync() != nil {
		return errors.New("sync history temporary file failed")
	}
	if temp.Close() != nil {
		return errors.New("close history temporary file failed")
	}
	if store.renameRoot(root, tempName, name) != nil {
		return errors.New("commit history failed")
	}
	committed = true
	_ = syncRootDirectory(root)
	return nil
}

func syncRootDirectory(root *os.Root) error {
	directory, err := root.Open(".")
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func isTempName(name string) bool { return strings.HasPrefix(name, tempFilePrefix) }
