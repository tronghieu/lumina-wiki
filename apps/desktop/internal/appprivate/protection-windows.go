//go:build windows

package appprivate

import (
	"errors"
	"os"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
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
	maxSecurityDescriptor   = 64 * 1024
)

var securityAdvapi32 = syscall.NewLazyDLL("advapi32.dll")
var securityKernel32 = syscall.NewLazyDLL("kernel32.dll")
var convertSDDL = securityAdvapi32.NewProc("ConvertStringSecurityDescriptorToSecurityDescriptorW")
var setKernelSecurity = securityAdvapi32.NewProc("SetKernelObjectSecurity")
var getKernelSecurity = securityAdvapi32.NewProc("GetKernelObjectSecurity")
var securityToSDDL = securityAdvapi32.NewProc("ConvertSecurityDescriptorToStringSecurityDescriptorW")
var localFreeSecurity = securityKernel32.NewProc("LocalFree")
var getFinalPath = securityKernel32.NewProc("GetFinalPathNameByHandleW")

func platformProtectHandle(file *os.File, _ os.FileMode) error {
	secured, err := reopenSecurityHandle(file, readControl|writeDAC|fileReadAttributes)
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
		return errors.New("create protected DACL failed")
	}
	defer localFreeSecurity.Call(descriptor)
	result, _, _ = setKernelSecurity.Call(secured.Fd(), daclSecurityInformation, descriptor)
	if result == 0 {
		return errors.New("apply protected DACL failed")
	}
	return platformValidateProtectedHandle(file)
}

func platformValidateProtectedHandle(file *os.File) error {
	secured, err := reopenSecurityHandle(file, readControl|fileReadAttributes)
	if err != nil {
		return err
	}
	defer secured.Close()
	var needed uint32
	getKernelSecurity.Call(secured.Fd(), daclSecurityInformation, 0, 0, uintptr(unsafe.Pointer(&needed)))
	if needed == 0 || needed > maxSecurityDescriptor {
		return errors.New("read protected DACL failed")
	}
	descriptor := make([]byte, needed)
	result, _, _ := getKernelSecurity.Call(secured.Fd(), daclSecurityInformation,
		uintptr(unsafe.Pointer(&descriptor[0])), uintptr(len(descriptor)), uintptr(unsafe.Pointer(&needed)))
	if result == 0 {
		return errors.New("read protected DACL failed")
	}
	var encoded *uint16
	var length uint32
	result, _, _ = securityToSDDL.Call(uintptr(unsafe.Pointer(&descriptor[0])), sddlRevision1,
		daclSecurityInformation, uintptr(unsafe.Pointer(&encoded)), uintptr(unsafe.Pointer(&length)))
	if result == 0 || encoded == nil || length == 0 {
		return errors.New("encode protected DACL failed")
	}
	defer func() {
		localFreeSecurity.Call(uintptr(unsafe.Pointer(encoded)))
		runtime.KeepAlive(encoded)
	}()
	sddl := syscall.UTF16ToString(unsafe.Slice(encoded, length))
	if sddl != "D:P(A;;FA;;;OW)(A;;FA;;;SY)" && sddl != "D:P(A;;FA;;;SY)(A;;FA;;;OW)" {
		return errors.New("private state DACL is unsafe")
	}
	securityDescriptor, err := windows.GetSecurityInfo(windows.Handle(secured.Fd()), windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return errors.New("read private state owner failed")
	}
	owner, _, err := securityDescriptor.Owner()
	if err != nil || owner == nil {
		return errors.New("read private state owner failed")
	}
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil || !owner.Equals(tokenUser.User.Sid) {
		return errors.New("private state owner is unsafe")
	}
	return nil
}

func reopenSecurityHandle(original *os.File, access uint32) (*os.File, error) {
	originalInfo, err := original.Stat()
	if err != nil {
		return nil, errors.New("stat private security handle failed")
	}
	buffer := make([]uint16, 32768)
	length, _, _ := getFinalPath.Call(original.Fd(), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0)
	if length == 0 || length >= uintptr(len(buffer)) {
		return nil, errors.New("resolve private security handle path failed")
	}
	handle, err := syscall.CreateFile(&buffer[0], access, fileShareRead|fileShareWrite|fileShareDelete,
		nil, syscall.OPEN_EXISTING, fileFlagBackupSemantics, 0)
	if err != nil {
		return nil, errors.New("reopen private security handle failed")
	}
	reopened := os.NewFile(uintptr(handle), "app-private-security")
	reopenedInfo, statErr := reopened.Stat()
	if statErr != nil || !os.SameFile(originalInfo, reopenedInfo) {
		reopened.Close()
		return nil, ErrStateChanged
	}
	return reopened, nil
}
