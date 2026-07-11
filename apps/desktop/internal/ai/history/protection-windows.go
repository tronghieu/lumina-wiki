//go:build windows

package history

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

const (
	sddlRevision1           = 1
	daclSecurityInformation = 0x00000004
	readControl             = 0x00020000
	writeDAC                = 0x00040000
	fileReadAttributes      = 0x00000080
	fileShareRead           = 0x00000001
	fileShareWrite          = 0x00000002
	fileShareDelete         = 0x00000004
	fileFlagBackupSemantics = 0x02000000
)

var aclAdvapi32 = syscall.NewLazyDLL("advapi32.dll")
var aclKernel32 = syscall.NewLazyDLL("kernel32.dll")
var convertSDDL = aclAdvapi32.NewProc("ConvertStringSecurityDescriptorToSecurityDescriptorW")
var setKernelSecurity = aclAdvapi32.NewProc("SetKernelObjectSecurity")
var localFreeSecurity = aclKernel32.NewProc("LocalFree")
var getFinalPath = aclKernel32.NewProc("GetFinalPathNameByHandleW")

func platformProtectHandle(file *os.File, _ os.FileMode) error {
	secured, err := reopenWithWriteDAC(file)
	if err != nil {
		return err
	}
	defer secured.Close()
	sddl, err := syscall.UTF16PtrFromString("D:P(A;;FA;;;OW)(A;;FA;;;SY)")
	if err != nil {
		return err
	}
	var descriptor uintptr
	result, _, _ := convertSDDL.Call(uintptr(unsafe.Pointer(sddl)), sddlRevision1,
		uintptr(unsafe.Pointer(&descriptor)), 0)
	if result == 0 || descriptor == 0 {
		return errors.New("convert protected DACL failed")
	}
	defer localFreeSecurity.Call(descriptor)
	result, _, _ = setKernelSecurity.Call(secured.Fd(), daclSecurityInformation, descriptor)
	if result == 0 {
		return errors.New("apply protected DACL failed")
	}
	return nil
}

func reopenWithWriteDAC(original *os.File) (*os.File, error) {
	originalInfo, err := original.Stat()
	if err != nil {
		return nil, errors.New("stat original security handle failed")
	}
	buffer := make([]uint16, 32768)
	length, _, _ := getFinalPath.Call(original.Fd(), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0)
	if length == 0 || length >= uintptr(len(buffer)) {
		return nil, errors.New("resolve security handle path failed")
	}
	path := &buffer[0]
	handle, err := syscall.CreateFile(path, readControl|writeDAC|fileReadAttributes,
		fileShareRead|fileShareWrite|fileShareDelete, nil, syscall.OPEN_EXISTING, fileFlagBackupSemantics, 0)
	if err != nil {
		return nil, errors.New("reopen security handle failed")
	}
	reopened := os.NewFile(uintptr(handle), "history-security")
	reopenedInfo, statErr := reopened.Stat()
	if statErr != nil || !os.SameFile(originalInfo, reopenedInfo) {
		_ = reopened.Close()
		return nil, errors.New("security handle identity changed")
	}
	return reopened, nil
}

func platformEnsureProtectedHandle(file *os.File) error { return platformProtectHandle(file, 0) }
