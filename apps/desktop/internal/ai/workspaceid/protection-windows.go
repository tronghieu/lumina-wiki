//go:build windows

package workspaceid

import (
	"errors"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	registryReadControl        = 0x00020000
	registryWriteDAC           = 0x00040000
	registryReadAttributes     = 0x00000080
	registryFileAllAccess      = 0x001F01FF
	registryShareRead          = 0x00000001
	registryShareWrite         = 0x00000002
	registryShareDelete        = 0x00000004
	registryBackupSemantics    = 0x02000000
	registrySecurityPathBuffer = 32768
)

var registrySecurityKernel32 = syscall.NewLazyDLL("kernel32.dll")
var registryFinalPath = registrySecurityKernel32.NewProc("GetFinalPathNameByHandleW")

func platformSecurePrivateDirectory(path string, expected os.FileInfo) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	opened, err := directory.Stat()
	if err != nil || !os.SameFile(expected, opened) {
		return errors.New("registry directory changed")
	}
	return protectRegistryHandle(directory)
}

func platformValidatePrivateDirectory(path string, expected os.FileInfo) bool {
	directory, err := os.Open(path)
	if err != nil {
		return false
	}
	defer directory.Close()
	opened, err := directory.Stat()
	return err == nil && os.SameFile(expected, opened) && validateRegistryHandle(directory) == nil
}

func platformSecurePrivateFile(file *os.File) error { return protectRegistryHandle(file) }

func platformValidatePrivateFile(file *os.File) bool { return validateRegistryHandle(file) == nil }

func platformSecureLockMode(file *os.File) error { return protectRegistryHandle(file) }

func protectRegistryHandle(file *os.File) error {
	secured, err := reopenRegistrySecurityHandle(file, registryReadControl|registryWriteDAC|registryReadAttributes)
	if err != nil {
		return err
	}
	defer secured.Close()
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil {
		return errors.New("registry owner is unavailable")
	}
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return errors.New("registry SYSTEM identity is unavailable")
	}
	entries := []windows.EXPLICIT_ACCESS{registryFullAccessEntry(tokenUser.User.Sid, windows.TRUSTEE_IS_USER)}
	if !tokenUser.User.Sid.Equals(system) {
		entries = append(entries, registryFullAccessEntry(system, windows.TRUSTEE_IS_WELL_KNOWN_GROUP))
	}
	acl, err := windows.ACLFromEntries(entries, nil)
	if err != nil {
		return err
	}
	if err := windows.SetSecurityInfo(
		windows.Handle(secured.Fd()),
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		acl,
		nil,
	); err != nil {
		return err
	}
	return validateRegistryHandle(file)
}

func registryFullAccessEntry(sid *windows.SID, trusteeType windows.TRUSTEE_TYPE) windows.EXPLICIT_ACCESS {
	return windows.EXPLICIT_ACCESS{
		AccessPermissions: registryFileAllAccess,
		AccessMode:        windows.GRANT_ACCESS,
		Inheritance:       windows.NO_INHERITANCE,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  trusteeType,
			TrusteeValue: windows.TrusteeValueFromSID(sid),
		},
	}
}

func validateRegistryHandle(file *os.File) error {
	secured, err := reopenRegistrySecurityHandle(file, registryReadControl|registryReadAttributes)
	if err != nil {
		return err
	}
	defer secured.Close()
	descriptor, err := windows.GetSecurityInfo(
		windows.Handle(secured.Fd()),
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return err
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil {
		return errors.New("registry owner is unavailable")
	}
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil || !owner.Equals(tokenUser.User.Sid) {
		return errors.New("registry owner is unsafe")
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return errors.New("registry DACL is not protected")
	}
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return err
	}
	expected := map[string]bool{tokenUser.User.Sid.String(): false}
	expected[system.String()] = false
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil || int(dacl.AceCount) != len(expected) {
		return errors.New("registry DACL is unsafe")
	}
	for index := uint16(0); index < dacl.AceCount; index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, uint32(index), &ace); err != nil ||
			ace == nil ||
			ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE ||
			ace.Header.AceFlags != 0 ||
			ace.Mask != registryFileAllAccess {
			return errors.New("registry DACL is unsafe")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		seen, ok := expected[sid.String()]
		if !ok || seen {
			return errors.New("registry DACL is unsafe")
		}
		expected[sid.String()] = true
	}
	for _, seen := range expected {
		if !seen {
			return errors.New("registry DACL is unsafe")
		}
	}
	return nil
}

func reopenRegistrySecurityHandle(original *os.File, access uint32) (*os.File, error) {
	originalInfo, err := original.Stat()
	if err != nil {
		return nil, err
	}
	buffer := make([]uint16, registrySecurityPathBuffer)
	length, _, callErr := registryFinalPath.Call(
		original.Fd(),
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
		0,
	)
	if length == 0 || length >= uintptr(len(buffer)) {
		if callErr != syscall.Errno(0) {
			return nil, callErr
		}
		return nil, errors.New("registry security path is unavailable")
	}
	handle, err := syscall.CreateFile(
		&buffer[0],
		access,
		registryShareRead|registryShareWrite|registryShareDelete,
		nil,
		syscall.OPEN_EXISTING,
		registryBackupSemantics,
		0,
	)
	if err != nil {
		return nil, err
	}
	reopened := os.NewFile(uintptr(handle), "workspace-registry-security")
	opened, err := reopened.Stat()
	if err != nil || !os.SameFile(originalInfo, opened) {
		_ = reopened.Close()
		return nil, errors.New("registry security handle changed")
	}
	return reopened, nil
}
