//go:build windows

package index

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

var indexKernel32 = syscall.NewLazyDLL("kernel32.dll")
var indexLockFileEx = indexKernel32.NewProc("LockFileEx")
var indexUnlockFileEx = indexKernel32.NewProc("UnlockFileEx")

func platformTryIndexLock(file *os.File) (bool, error) {
	var overlapped syscall.Overlapped
	result, _, callErr := indexLockFileEx.Call(file.Fd(), 0x3, 0, 0xffffffff, 0xffffffff, uintptr(unsafe.Pointer(&overlapped)))
	if result != 0 {
		return false, nil
	}
	if errors.Is(callErr, syscall.Errno(33)) || errors.Is(callErr, syscall.ERROR_ACCESS_DENIED) {
		return true, nil
	}
	return false, callErr
}
func platformUnlockIndex(file *os.File) error {
	var overlapped syscall.Overlapped
	result, _, callErr := indexUnlockFileEx.Call(file.Fd(), 0, 0xffffffff, 0xffffffff, uintptr(unsafe.Pointer(&overlapped)))
	if result == 0 {
		return callErr
	}
	return nil
}
