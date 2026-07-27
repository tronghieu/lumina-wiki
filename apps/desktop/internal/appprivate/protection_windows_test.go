//go:build windows

package appprivate

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
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

func TestPlatformProtectHandleAppliesDirectoryDACL(t *testing.T) {
	directory, err := os.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer directory.Close()
	if err := platformProtectHandle(directory, 0o700); err != nil {
		t.Fatalf("platformProtectHandle: %v", err)
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

func TestProtectedAccessEntriesDeduplicateEqualOwnerAndSystemSID(t *testing.T) {
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		t.Fatal(err)
	}
	entries := protectedAccessEntries(system, system)
	if len(entries) != 1 {
		t.Fatalf("equal owner and SYSTEM produced %d entries", len(entries))
	}
	if entries[0].AccessPermissions != fileAllAccess ||
		entries[0].Trustee.TrusteeValue != windows.TrusteeValueFromSID(system) {
		t.Fatal("deduplicated owner entry lost full access")
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
	descriptor, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetSecurityInfo(
		windows.Handle(secured.Fd()),
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		dacl,
		nil,
	)
}
