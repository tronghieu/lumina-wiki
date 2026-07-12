//go:build windows

package index

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"unsafe"
)

func TestWindowsReadOnlyProtectionValidationRejectsPermissiveACL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "protected.f32")
	if err := os.WriteFile(path, []byte{0, 0, 0, 0}, 0o600); err != nil {
		t.Fatal(err)
	}
	writable, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := platformProtectIndexHandle(writable, 0); err != nil {
		writable.Close()
		t.Fatal(err)
	}
	writable.Close()
	readOnly, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := platformValidateIndexProtectedHandle(readOnly); err != nil {
		readOnly.Close()
		t.Fatal(err)
	}
	readOnly.Close()
	if err := applyTestDACL(path, "D:P(A;;FA;;;WD)"); err != nil {
		t.Fatal(err)
	}
	readOnly, err = os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer readOnly.Close()
	if err := platformValidateIndexProtectedHandle(readOnly); err == nil {
		t.Fatal("permissive DACL accepted")
	}
}

func applyTestDACL(path, sddl string) error {
	file, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer file.Close()
	secured, err := reopenIndexSecurityHandle(file)
	if err != nil {
		return err
	}
	defer secured.Close()
	encoded, err := syscall.UTF16PtrFromString(sddl)
	if err != nil {
		return err
	}
	var descriptor uintptr
	result, _, callErr := indexConvertSDDL.Call(uintptr(unsafe.Pointer(encoded)), 1, uintptr(unsafe.Pointer(&descriptor)), 0)
	if result == 0 {
		return callErr
	}
	defer indexLocalFree.Call(descriptor)
	result, _, callErr = indexSetSecurity.Call(secured.Fd(), 0x4, descriptor)
	if result == 0 {
		return callErr
	}
	return nil
}
