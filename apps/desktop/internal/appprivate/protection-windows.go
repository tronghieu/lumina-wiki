//go:build windows

package appprivate

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	readControl             = 0x00020000
	writeDAC                = 0x00040000
	fileReadAttributes      = 0x00000080
	fileAllAccess           = 0x001F01FF
	fileShareRead           = 0x00000001
	fileShareWrite          = 0x00000002
	fileShareDelete         = 0x00000004
	fileFlagBackupSemantics = 0x02000000
)

var securityKernel32 = syscall.NewLazyDLL("kernel32.dll")
var getFinalPath = securityKernel32.NewProc("GetFinalPathNameByHandleW")

func platformProtectHandle(file *os.File, _ os.FileMode) error {
	secured, err := reopenSecurityHandle(file, readControl|writeDAC|fileReadAttributes)
	if err != nil {
		return err
	}
	defer secured.Close()
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil {
		return errors.New("read private state owner failed")
	}
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return errors.New("create protected DACL failed")
	}
	acl, err := windows.ACLFromEntries(protectedAccessEntries(tokenUser.User.Sid, system), nil)
	if err != nil {
		return fmt.Errorf("create protected DACL failed: %w", err)
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
		return fmt.Errorf("apply protected DACL failed: %w", err)
	}
	return platformValidateProtectedHandle(file)
}

func protectedAccessEntries(owner, system *windows.SID) []windows.EXPLICIT_ACCESS {
	entries := []windows.EXPLICIT_ACCESS{fullAccessEntry(owner, windows.TRUSTEE_IS_USER)}
	if !owner.Equals(system) {
		entries = append(entries, fullAccessEntry(system, windows.TRUSTEE_IS_WELL_KNOWN_GROUP))
	}
	return entries
}

func fullAccessEntry(sid *windows.SID, trusteeType windows.TRUSTEE_TYPE) windows.EXPLICIT_ACCESS {
	return windows.EXPLICIT_ACCESS{
		AccessPermissions: fileAllAccess,
		AccessMode:        windows.GRANT_ACCESS,
		Inheritance:       windows.NO_INHERITANCE,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  trusteeType,
			TrusteeValue: windows.TrusteeValueFromSID(sid),
		},
	}
}

func platformValidateProtectedHandle(file *os.File) error {
	secured, err := reopenSecurityHandle(file, readControl|fileReadAttributes)
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
		return errors.New("read protected DACL failed")
	}
	owner, _, err := descriptor.Owner()
	if err != nil || owner == nil {
		return errors.New("read private state owner failed")
	}
	tokenUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil || !owner.Equals(tokenUser.User.Sid) {
		return errors.New("private state owner is unsafe")
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return errors.New("private state DACL is unsafe")
	}
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return errors.New("read protected DACL failed")
	}
	expected := map[string]bool{
		tokenUser.User.Sid.String(): false,
	}
	expected[system.String()] = false
	dacl, _, err := descriptor.DACL()
	if err != nil || dacl == nil || int(dacl.AceCount) != len(expected) {
		return errors.New("private state DACL is unsafe")
	}
	for index := uint16(0); index < dacl.AceCount; index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, uint32(index), &ace); err != nil ||
			ace == nil ||
			ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE ||
			ace.Header.AceFlags != 0 ||
			ace.Mask != fileAllAccess {
			return errors.New("private state DACL is unsafe")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		key := sid.String()
		seen, ok := expected[key]
		if !ok || seen {
			return errors.New("private state DACL is unsafe")
		}
		expected[key] = true
	}
	for _, seen := range expected {
		if !seen {
			return errors.New("private state DACL is unsafe")
		}
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
		return nil, fmt.Errorf("reopen private security handle failed: %w", err)
	}
	reopened := os.NewFile(uintptr(handle), "app-private-security")
	reopenedInfo, statErr := reopened.Stat()
	if statErr != nil || !os.SameFile(originalInfo, reopenedInfo) {
		reopened.Close()
		return nil, ErrStateChanged
	}
	return reopened, nil
}
