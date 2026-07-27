//go:build windows

package workspaceid

import (
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsFileIDInfo struct {
	VolumeSerialNumber uint64
	FileID             [16]byte
}

func platformHandleSignature(handle DirectoryHandle) (Signature, bool, error) {
	file, ok := handle.(*os.File)
	if !ok {
		return "", false, nil
	}
	var identity windowsFileIDInfo
	err := windows.GetFileInformationByHandleEx(
		windows.Handle(file.Fd()),
		windows.FileIdInfo,
		(*byte)(unsafe.Pointer(&identity)),
		uint32(unsafe.Sizeof(identity)),
	)
	if err != nil {
		return "", false, errors.New("workspace identity probe failed")
	}
	return Signature(fmt.Sprintf("windows-v1:%x:%s", identity.VolumeSerialNumber,
		hex.EncodeToString(identity.FileID[:]))), true, nil
}

func platformLegacyHandleSignature(handle DirectoryHandle) (Signature, bool, error) {
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
