//go:build !linux && !darwin && !freebsd && !openbsd && !netbsd && !dragonfly && !windows

package appprivate

import "os"

func platformTryLock(*os.File) (bool, error) { return false, ErrLockUnsupported }
func platformUnlock(*os.File) error          { return nil }
