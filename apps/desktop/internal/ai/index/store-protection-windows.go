//go:build windows

package index

import (
	"errors"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

var indexAdvapi32 = syscall.NewLazyDLL("advapi32.dll")
var indexConvertSDDL = indexAdvapi32.NewProc("ConvertStringSecurityDescriptorToSecurityDescriptorW")
var indexSetSecurity = indexAdvapi32.NewProc("SetKernelObjectSecurity")
var indexGetSecurity = indexAdvapi32.NewProc("GetKernelObjectSecurity")
var indexSecurityToSDDL = indexAdvapi32.NewProc("ConvertSecurityDescriptorToStringSecurityDescriptorW")
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
	return reopenIndexHandle(original, 0x00020000|0x00040000|0x00000080)
}

func reopenIndexHandle(original *os.File, access uint32) (*os.File, error) {
	originalInfo, err := original.Stat()
	if err != nil {
		return nil, errors.New("stat semantic security handle failed")
	}
	buffer := make([]uint16, 32768)
	length, _, _ := indexFinalPath.Call(original.Fd(), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0)
	if length == 0 || length >= uintptr(len(buffer)) {
		return nil, errors.New("resolve semantic security handle failed")
	}
	handle, err := syscall.CreateFile(&buffer[0], access,
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

func platformValidateIndexProtectedHandle(file *os.File) error {
	secured, err := reopenIndexHandle(file, 0x00020000|0x00000080)
	if err != nil {
		return err
	}
	defer secured.Close()
	var needed uint32
	indexGetSecurity.Call(secured.Fd(), 0x4, 0, 0, uintptr(unsafe.Pointer(&needed)))
	if needed == 0 || needed > 64*1024 {
		return errors.New("read protected DACL failed")
	}
	descriptor := make([]byte, needed)
	result, _, _ := indexGetSecurity.Call(secured.Fd(), 0x4, uintptr(unsafe.Pointer(&descriptor[0])), uintptr(len(descriptor)), uintptr(unsafe.Pointer(&needed)))
	if result == 0 {
		return errors.New("read protected DACL failed")
	}
	var encoded *uint16
	var length uint32
	result, _, _ = indexSecurityToSDDL.Call(uintptr(unsafe.Pointer(&descriptor[0])), 1, 0x4, uintptr(unsafe.Pointer(&encoded)), uintptr(unsafe.Pointer(&length)))
	if result == 0 || encoded == nil || length == 0 {
		return errors.New("encode protected DACL failed")
	}
	defer func() {
		indexLocalFree.Call(uintptr(unsafe.Pointer(encoded)))
		runtime.KeepAlive(encoded)
	}()
	sddl := syscall.UTF16ToString(unsafe.Slice(encoded, length))
	if sddl != "D:P(A;;FA;;;OW)(A;;FA;;;SY)" && sddl != "D:P(A;;FA;;;SY)(A;;FA;;;OW)" {
		return errors.New("semantic index DACL is unsafe")
	}
	return nil
}
