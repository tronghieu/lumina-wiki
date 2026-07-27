//go:build windows

package appprivate

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func TestWindowsLockWinnerHardensFileCreatedByPausedContender(t *testing.T) {
	base := t.TempDir()
	creator := newTestStore(t, base)
	winner := newTestStore(t, base)
	created := make(chan struct{})
	resumeCreator := make(chan struct{})
	creator.lockCreatedHook = func() {
		close(created)
		<-resumeCreator
	}

	creatorResult := make(chan error, 1)
	go func() {
		release, err := creator.acquire(context.Background())
		if err == nil {
			release()
		}
		creatorResult <- err
	}()
	select {
	case <-created:
	case <-time.After(5 * time.Second):
		t.Fatal("creator did not expose the lock file")
	}

	winnerRelease, err := winner.acquire(context.Background())
	if err != nil {
		close(resumeCreator)
		t.Fatalf("winner failed to harden the visible lock: %v", err)
	}
	winnerRelease()
	close(resumeCreator)
	select {
	case err := <-creatorResult:
		if err != nil {
			t.Fatalf("creator failed after winner released the lock: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("creator did not resume")
	}

	lock, err := os.Open(creator.lockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := platformValidateProtectedHandle(lock); err != nil {
		t.Fatalf("lock DACL was not protected: %v", err)
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

func TestPrivateOwnerPolicyAcceptsOnlyCurrentUserOrActiveAdministrators(t *testing.T) {
	token := windows.GetCurrentProcessToken()
	tokenUser, err := token.GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if !isSafePrivateOwner(tokenUser.User.Sid, tokenUser.User.Sid, token) {
		t.Fatal("current user SID was rejected")
	}

	administrators, err := windows.CreateWellKnownSid(windows.WinBuiltinAdministratorsSid)
	if err != nil {
		t.Fatal(err)
	}
	isAdministrator, err := enabledPrivateTokenMembership(token, administrators)
	if err != nil {
		t.Fatal(err)
	}
	if got := isSafePrivateOwner(administrators, tokenUser.User.Sid, token); got != isAdministrator {
		t.Fatalf("Administrators owner policy = %t, token membership = %t", got, isAdministrator)
	}
	if !privateOwnerAllowed(administrators, tokenUser.User.Sid, administrators, true) {
		t.Fatal("active Administrators owner was rejected")
	}
	if privateOwnerAllowed(administrators, tokenUser.User.Sid, administrators, false) {
		t.Fatal("disabled Administrators owner was accepted")
	}

	everyone, err := windows.CreateWellKnownSid(windows.WinWorldSid)
	if err != nil {
		t.Fatal(err)
	}
	if isSafePrivateOwner(everyone, tokenUser.User.Sid, token) {
		t.Fatal("Everyone owner was accepted")
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
