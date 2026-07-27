//go:build !linux && !darwin && !freebsd && !openbsd && !netbsd && !dragonfly && !windows

package workspaceid

import (
	"errors"
	"os"
)

func platformTryLock(*os.File) error { return errors.New("kernel file locking is unsupported") }
func platformUnlock(*os.File) error  { return nil }
