//go:build windows

package workspace

import (
	"os"
	"path"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type renameInfoExHeader struct {
	Flags          uint32
	RootDirectory  windows.Handle
	FileNameLength uint32
	FileName       [1]uint16
}

const (
	deleteAccess       = 0x00010000
	synchronizeAccess  = 0x00100000
	fileShareRead      = 0x00000001
	fileShareWrite     = 0x00000002
	fileShareDelete    = 0x00000004
	invalidHandleValue = ^uintptr(0)
)

var reOpenFile = windows.NewLazySystemDLL("kernel32.dll").NewProc("ReOpenFile")

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
	var layout renameInfoExHeader
	nameOffset := unsafe.Offsetof(layout.FileName)
	buffer := make([]byte, int(nameOffset)+len(encoded)*2)
	header := (*renameInfoExHeader)(unsafe.Pointer(&buffer[0]))
	header.Flags = 0 // FILE_RENAME_FLAG_REPLACE_IF_EXISTS must remain unset.
	header.RootDirectory = windows.Handle(destinationParent.Fd())
	header.FileNameLength = uint32(len(encoded) * 2)
	target := unsafe.Slice((*uint16)(unsafe.Pointer(&buffer[nameOffset])), len(encoded))
	copy(target, encoded)
	return windows.SetFileInformationByHandle(
		windows.Handle(renameSource.Fd()),
		windows.FileRenameInfoEx,
		&buffer[0],
		uint32(len(buffer)),
	)
}
