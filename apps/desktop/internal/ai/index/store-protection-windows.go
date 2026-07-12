//go:build windows

package index

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

var indexAdvapi32 = syscall.NewLazyDLL("advapi32.dll")
var indexConvertSDDL = indexAdvapi32.NewProc("ConvertStringSecurityDescriptorToSecurityDescriptorW")
var indexSetSecurity = indexAdvapi32.NewProc("SetKernelObjectSecurity")
var indexLocalFree = indexKernel32.NewProc("LocalFree")
var indexFinalPath = indexKernel32.NewProc("GetFinalPathNameByHandleW")

func platformProtectIndexHandle(file *os.File, _ os.FileMode) error {
	secured, err := reopenIndexSecurityHandle(file)
	if err != nil {
		return err
	}
	defer secured.Close()
	sddl, err := syscall.UTF16PtrFromString("D:P(A;;FA;;;OW)(A;;FA;;;SY)")
	if err != nil {
		return err
	}
	var descriptor uintptr
	result, _, _ := indexConvertSDDL.Call(uintptr(unsafe.Pointer(sddl)), 1, uintptr(unsafe.Pointer(&descriptor)), 0)
	if result == 0 || descriptor == 0 {
		return errors.New("create protected DACL failed")
	}
	defer indexLocalFree.Call(descriptor)
	result, _, _ = indexSetSecurity.Call(secured.Fd(), 0x4, descriptor)
	if result == 0 {
		return errors.New("apply protected DACL failed")
	}
	return nil
}

func reopenIndexSecurityHandle(original *os.File) (*os.File, error) {
	originalInfo, err := original.Stat()
	if err != nil {
		return nil, errors.New("stat semantic security handle failed")
	}
	buffer := make([]uint16, 32768)
	length, _, _ := indexFinalPath.Call(original.Fd(), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0)
	if length == 0 || length >= uintptr(len(buffer)) {
		return nil, errors.New("resolve semantic security handle failed")
	}
	handle, err := syscall.CreateFile(&buffer[0], 0x00020000|0x00040000|0x00000080,
		0x1|0x2|0x4, nil, syscall.OPEN_EXISTING, 0x02000000, 0)
	if err != nil {
		return nil, errors.New("reopen semantic security handle failed")
	}
	reopened := os.NewFile(uintptr(handle), "semantic-index-security")
	reopenedInfo, statErr := reopened.Stat()
	if statErr != nil || !os.SameFile(originalInfo, reopenedInfo) {
		reopened.Close()
		return nil, errors.New("semantic security handle changed")
	}
	return reopened, nil
}
func privateIndexFile(os.FileInfo) bool      { return true }
func privateIndexDirectory(os.FileInfo) bool { return true }
func platformEnsureIndexProtectedHandle(file *os.File) error {
	return platformProtectIndexHandle(file, 0)
}
