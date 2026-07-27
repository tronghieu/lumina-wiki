//go:build windows

package workspace

import (
	"os"
	"path"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type renameInfoHeader struct {
	ReplaceIfExists byte
	RootDirectory   windows.Handle
	FileNameLength  uint32
	FileName        [1]uint16
}

type ioStatusBlock struct {
	Status      uintptr
	Information uintptr
}

const (
	deleteAccess       = 0x00010000
	synchronizeAccess  = 0x00100000
	fileShareRead      = 0x00000001
	fileShareWrite     = 0x00000002
	fileShareDelete    = 0x00000004
	invalidHandleValue = ^uintptr(0)
	fileRenameInfo     = 10
)

var reOpenFile = windows.NewLazySystemDLL("kernel32.dll").NewProc("ReOpenFile")
var nativeWindows = windows.NewLazySystemDLL("ntdll.dll")
var ntSetInformationFile = nativeWindows.NewProc("NtSetInformationFile")
var rtlNtStatusToDosError = nativeWindows.NewProc("RtlNtStatusToDosError")

func platformPublishNoReplace(root *os.Root, oldName, newName string) error {
	source, err := root.OpenFile(oldName, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer source.Close()
	reopened, _, callErr := reOpenFile.Call(
		source.Fd(),
		deleteAccess|synchronizeAccess,
		fileShareRead|fileShareWrite|fileShareDelete,
		0,
	)
	if reopened == 0 || reopened == invalidHandleValue {
		return callErr
	}
	renameSource := os.NewFile(reopened, oldName)
	if renameSource == nil {
		_ = windows.CloseHandle(windows.Handle(reopened))
		return syscall.EINVAL
	}
	defer renameSource.Close()
	destinationParent, err := root.Open(path.Dir(newName))
	if err != nil {
		return err
	}
	defer destinationParent.Close()
	encoded, err := syscall.UTF16FromString(path.Base(newName))
	if err != nil {
		return err
	}
	encoded = encoded[:len(encoded)-1]
	var layout renameInfoHeader
	nameOffset := unsafe.Offsetof(layout.FileName)
	buffer := make([]byte, int(nameOffset)+len(encoded)*2)
	header := (*renameInfoHeader)(unsafe.Pointer(&buffer[0]))
	header.ReplaceIfExists = 0
	header.RootDirectory = windows.Handle(destinationParent.Fd())
	header.FileNameLength = uint32(len(encoded) * 2)
	target := unsafe.Slice((*uint16)(unsafe.Pointer(&buffer[nameOffset])), len(encoded))
	copy(target, encoded)
	var statusBlock ioStatusBlock
	status, _, _ := ntSetInformationFile.Call(
		renameSource.Fd(),
		uintptr(unsafe.Pointer(&statusBlock)),
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
		fileRenameInfo,
	)
	runtime.KeepAlive(renameSource)
	runtime.KeepAlive(destinationParent)
	runtime.KeepAlive(buffer)
	if int32(status) >= 0 {
		return nil
	}
	code, _, _ := rtlNtStatusToDosError.Call(status)
	if code == 0 {
		return syscall.EINVAL
	}
	return syscall.Errno(code)
}
