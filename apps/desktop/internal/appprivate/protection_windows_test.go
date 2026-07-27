//go:build windows

package appprivate

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"unsafe"
)

func TestWindowsStoreAppliesAndVerifiesOwnerSystemDACL(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("private")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{store.appDir, store.stateDir, store.lockPath, store.statePath} {
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := platformValidateProtectedHandle(file); err != nil {
			file.Close()
			t.Fatalf("%s: %v", filepath.Base(path), err)
		}
		file.Close()
	}
}

func TestWindowsStoreRejectsPermissiveFinalDACL(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("private")); err != nil {
		t.Fatal(err)
	}
	if err := applyTestDACL(store.statePath, "D:P(A;;FA;;;WD)"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Read(context.Background()); err == nil {
		t.Fatal("permissive state DACL accepted")
	}
}

func applyTestDACL(path, sddl string) error {
	file, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer file.Close()
	secured, err := reopenSecurityHandle(file, readControl|writeDAC|fileReadAttributes)
	if err != nil {
		return err
	}
	defer secured.Close()
	encoded, err := syscall.UTF16PtrFromString(sddl)
	if err != nil {
		return err
	}
	var descriptor uintptr
	result, _, callErr := convertSDDL.Call(uintptr(unsafe.Pointer(encoded)), sddlRevision1, uintptr(unsafe.Pointer(&descriptor)), 0)
	if result == 0 {
		return callErr
	}
	defer localFreeSecurity.Call(descriptor)
	result, _, callErr = setKernelSecurity.Call(secured.Fd(), daclSecurityInformation, descriptor)
	if result == 0 {
		return callErr
	}
	return nil
}
