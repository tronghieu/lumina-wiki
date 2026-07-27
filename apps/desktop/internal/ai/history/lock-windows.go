//go:build windows

package history

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

const lockExclusive = 0x2
const lockFailImmediately = 0x1

var kernel32 = syscall.NewLazyDLL("kernel32.dll")
var lockFileEx = kernel32.NewProc("LockFileEx")
var unlockFileEx = kernel32.NewProc("UnlockFileEx")

func platformTryLock(file *os.File) (bool, error) {
	var overlapped syscall.Overlapped
	result, _, callErr := lockFileEx.Call(file.Fd(), lockExclusive|lockFailImmediately, 0, 0xffffffff, 0xffffffff, uintptr(unsafe.Pointer(&overlapped)))
	if result != 0 {
		return false, nil
	}
	if errors.Is(callErr, syscall.Errno(33)) || errors.Is(callErr, syscall.ERROR_ACCESS_DENIED) {
		return true, nil
	}
	return false, callErr
}

func platformUnlock(file *os.File) error {
	var overlapped syscall.Overlapped
	result, _, callErr := unlockFileEx.Call(file.Fd(), 0, 0xffffffff, 0xffffffff, uintptr(unsafe.Pointer(&overlapped)))
	if result == 0 {
		return callErr
	}
	return nil
}
