//go:build windows

package workspaceid

import (
	"errors"
	"fmt"
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
	return platformPrivateDirectoryValidationError(path, expected) == nil
}

func platformPrivateDirectoryValidationError(path string, expected os.FileInfo) error {
	directory, err := os.Open(path)
	if err != nil {
		return errors.New("open registry directory security handle failed")
	}
	defer directory.Close()
	opened, err := directory.Stat()
	if err != nil {
		return errors.New("stat registry directory security handle failed")
	}
	if !os.SameFile(expected, opened) {
		return errors.New("registry directory identity changed")
	}
	if err := validateRegistryHandle(directory); err != nil {
		return err
	}
	return nil
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
	token := windows.GetCurrentProcessToken()
	tokenUser, err := token.GetTokenUser()
	if err != nil || tokenUser == nil || tokenUser.User.Sid == nil {
		return errors.New("registry owner is unsafe")
	}
	if !isSafeRegistryOwner(owner, tokenUser.User.Sid, token) {
		return errors.New("registry owner is unsafe")
	}
	control, _, err := descriptor.Control()
	if err != nil {
		return errors.New("read registry DACL control failed")
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return errors.New("registry DACL is not protected")
	}
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return err
	}
	expected := map[string]bool{tokenUser.User.Sid.String(): false}
	expected[system.String()] = false
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return errors.New("read registry DACL failed")
	}
	if dacl == nil {
		return errors.New("registry DACL is absent")
	}
	if int(dacl.AceCount) != len(expected) {
		return fmt.Errorf("registry DACL ACE count is unsafe: got %d want %d", dacl.AceCount, len(expected))
	}
	for index := uint16(0); index < dacl.AceCount; index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, uint32(index), &ace); err != nil || ace == nil {
			return fmt.Errorf("read registry DACL ACE %d failed", index)
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return fmt.Errorf("registry DACL ACE %d type is unsafe", index)
		}
		if ace.Header.AceFlags != 0 {
			return fmt.Errorf("registry DACL ACE %d flags are unsafe: %#x", index, ace.Header.AceFlags)
		}
		if ace.Mask != registryFileAllAccess {
			return fmt.Errorf("registry DACL ACE %d mask is unsafe: %#x", index, ace.Mask)
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		seen, ok := expected[sid.String()]
		if !ok {
			return fmt.Errorf(
				"registry DACL ACE %d principal is unexpected (%s; owner=%s)",
				index,
				classifyRegistryPrincipal(sid, owner),
				classifyRegistryOwner(owner, tokenUser.User.Sid),
			)
		}
		if seen {
			return fmt.Errorf("registry DACL ACE %d principal is duplicated", index)
		}
		expected[sid.String()] = true
	}
	for principal, seen := range expected {
		if !seen {
			category := "current user"
			if principal == system.String() {
				category = "SYSTEM"
			}
			return fmt.Errorf("registry DACL is missing %s", category)
		}
	}
	return nil
}

func classifyRegistryPrincipal(sid, owner *windows.SID) string {
	if sid != nil && owner != nil && sid.Equals(owner) {
		return "owner"
	}
	known := []struct {
		kind  windows.WELL_KNOWN_SID_TYPE
		label string
	}{
		{windows.WinBuiltinAdministratorsSid, "Administrators"},
		{windows.WinWorldSid, "Everyone"},
		{windows.WinAuthenticatedUserSid, "Authenticated Users"},
		{windows.WinBuiltinUsersSid, "Users"},
		{windows.WinCreatorOwnerSid, "Creator Owner"},
	}
	for _, candidate := range known {
		knownSID, err := windows.CreateWellKnownSid(candidate.kind)
		if err == nil && sid != nil && sid.Equals(knownSID) {
			return candidate.label
		}
	}
	return "other"
}

func classifyRegistryOwner(owner, currentUser *windows.SID) string {
	if owner != nil && currentUser != nil && owner.Equals(currentUser) {
		return "current user"
	}
	administrators, err := windows.CreateWellKnownSid(windows.WinBuiltinAdministratorsSid)
	if err == nil && owner != nil && owner.Equals(administrators) {
		return "Administrators"
	}
	return "other"
}

func isSafeRegistryOwner(owner, currentUser *windows.SID, token windows.Token) bool {
	if owner == nil || currentUser == nil {
		return false
	}
	if owner.Equals(currentUser) {
		return true
	}
	administrators, err := windows.CreateWellKnownSid(windows.WinBuiltinAdministratorsSid)
	if err != nil || !owner.Equals(administrators) {
		return false
	}
	member, err := enabledRegistryTokenMembership(token, administrators)
	return err == nil && registryOwnerAllowed(owner, currentUser, administrators, member)
}

func registryOwnerAllowed(owner, currentUser, administrators *windows.SID, activeAdministrator bool) bool {
	return owner != nil &&
		currentUser != nil &&
		administrators != nil &&
		(owner.Equals(currentUser) || activeAdministrator && owner.Equals(administrators))
}

func enabledRegistryTokenMembership(token windows.Token, sid *windows.SID) (bool, error) {
	groups, err := token.GetTokenGroups()
	if err != nil {
		return false, err
	}
	for _, group := range groups.AllGroups() {
		if group.Sid != nil && group.Sid.Equals(sid) {
			return group.Attributes&windows.SE_GROUP_ENABLED != 0 &&
				group.Attributes&windows.SE_GROUP_USE_FOR_DENY_ONLY == 0, nil
		}
	}
	return false, nil
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
