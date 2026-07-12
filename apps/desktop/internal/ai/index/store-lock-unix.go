//go:build linux || darwin || freebsd || openbsd || netbsd || dragonfly

package index

import (
	"errors"
	"os"
	"syscall"
)

func platformTryIndexLock(file *os.File) (bool, error) {
	err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
		return true, nil
	}
	return false, err
}
func platformUnlockIndex(file *os.File) error { return syscall.Flock(int(file.Fd()), syscall.LOCK_UN) }
