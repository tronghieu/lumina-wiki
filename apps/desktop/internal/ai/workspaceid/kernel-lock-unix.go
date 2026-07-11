//go:build linux || darwin || freebsd || openbsd || netbsd || dragonfly

package workspaceid

import (
	"errors"
	"os"
	"syscall"
)

func platformTryLock(file *os.File) error {
	err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
		return ErrRegistryBusy
	}
	return err
}

func platformUnlock(file *os.File) error { return syscall.Flock(int(file.Fd()), syscall.LOCK_UN) }
