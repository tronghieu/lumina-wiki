//go:build windows

package workspaceid

import (
	"os"
	"os/exec"
	"testing"

	"golang.org/x/sys/windows"
)

const registryDirectoryChildEnv = "LUMINA_TEST_REGISTRY_DIRECTORY_CHILD"
const registryDirectoryBaseEnv = "LUMINA_TEST_REGISTRY_DIRECTORY_BASE"

func TestWindowsRegistryDirectoryValidationAcrossProcess(t *testing.T) {
	if os.Getenv(registryDirectoryChildEnv) == "1" {
		store, err := newRegistryStore(os.Getenv(registryDirectoryBaseEnv))
		if err != nil {
			t.Fatal(err)
		}
		exists, err := store.ensureDir(false)
		if err != nil || !exists {
			t.Fatalf("child registry directory validation: exists=%t err=%v", exists, err)
		}
		return
	}

	base := t.TempDir()
	store, err := newRegistryStore(base)
	if err != nil {
		t.Fatal(err)
	}
	exists, err := store.ensureDir(true)
	if err != nil || !exists {
		t.Fatalf("parent registry directory setup: exists=%t err=%v", exists, err)
	}
	exists, err = store.ensureDir(false)
	if err != nil || !exists {
		t.Fatalf("parent registry directory validation: exists=%t err=%v", exists, err)
	}

	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.Command(executable, "-test.run", "^TestWindowsRegistryDirectoryValidationAcrossProcess$")
	child.Env = append(os.Environ(),
		registryDirectoryChildEnv+"=1",
		registryDirectoryBaseEnv+"="+base,
	)
	if output, err := child.CombinedOutput(); err != nil {
		t.Fatalf("child registry validation failed: %v\n%s", err, output)
	}
}

func TestRegistryStoreAppliesExactOwnerSystemDACLs(t *testing.T) {
	store, err := newRegistryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(emptyRegistry()); err != nil {
		t.Fatal(err)
	}
	release, err := store.acquireLock()
	if err != nil {
		t.Fatal(err)
	}
	release()

	directoryInfo, err := os.Stat(store.dir)
	if err != nil || !platformValidatePrivateDirectory(store.dir, directoryInfo) {
		t.Fatalf("registry directory DACL is unsafe: %v", err)
	}
	for _, path := range []string{store.path, store.lockPath} {
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		valid := platformValidatePrivateFile(file)
		file.Close()
		if !valid {
			t.Fatalf("%s DACL is unsafe", path)
		}
	}
}

func TestRegistryLoadRejectsPermissiveDACL(t *testing.T) {
	store, err := newRegistryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(emptyRegistry()); err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(store.path, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	secured, err := reopenRegistrySecurityHandle(file, registryReadControl|registryWriteDAC|registryReadAttributes)
	if err != nil {
		file.Close()
		t.Fatal(err)
	}
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;WD)")
	if err != nil {
		secured.Close()
		file.Close()
		t.Fatal(err)
	}
	dacl, _, err := descriptor.DACL()
	if err == nil {
		err = windows.SetSecurityInfo(
			windows.Handle(secured.Fd()),
			windows.SE_FILE_OBJECT,
			windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
			nil,
			nil,
			dacl,
			nil,
		)
	}
	secured.Close()
	file.Close()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("registry with permissive DACL was accepted")
	}
}

func TestRegistryOwnerPolicyAcceptsOnlyCurrentUserOrActiveAdministrators(t *testing.T) {
	token := windows.GetCurrentProcessToken()
	tokenUser, err := token.GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if !isSafeRegistryOwner(tokenUser.User.Sid, tokenUser.User.Sid, token) {
		t.Fatal("current user SID was rejected")
	}

	administrators, err := windows.CreateWellKnownSid(windows.WinBuiltinAdministratorsSid)
	if err != nil {
		t.Fatal(err)
	}
	isAdministrator, err := enabledRegistryTokenMembership(token, administrators)
	if err != nil {
		t.Fatal(err)
	}
	if got := isSafeRegistryOwner(administrators, tokenUser.User.Sid, token); got != isAdministrator {
		t.Fatalf("Administrators owner policy = %t, token membership = %t", got, isAdministrator)
	}
	if !registryOwnerAllowed(administrators, tokenUser.User.Sid, administrators, true) {
		t.Fatal("active Administrators owner was rejected")
	}
	if registryOwnerAllowed(administrators, tokenUser.User.Sid, administrators, false) {
		t.Fatal("disabled Administrators owner was accepted")
	}

	everyone, err := windows.CreateWellKnownSid(windows.WinWorldSid)
	if err != nil {
		t.Fatal(err)
	}
	if isSafeRegistryOwner(everyone, tokenUser.User.Sid, token) {
		t.Fatal("Everyone owner was accepted")
	}
}
