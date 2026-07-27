//go:build windows

package workspaceid

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

func platformHandleSignature(handle DirectoryHandle) (Signature, bool, error) {
	file, ok := handle.(*os.File)
	if !ok {
		return "", false, nil
	}
	var info syscall.ByHandleFileInformation
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetFileInformationByHandle")
	result, _, _ := proc.Call(file.Fd(), uintptr(unsafe.Pointer(&info)))
	if result == 0 {
		return "", false, nil
	}
	return Signature(fmt.Sprintf("windows:%x:%x%08x", info.VolumeSerialNumber,
		info.FileIndexHigh, info.FileIndexLow)), true, nil
}
