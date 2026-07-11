package secrets

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"

	keyring "github.com/zalando/go-keyring"
)

type fakeKeyring struct {
	values                    map[string]string
	setErr, getErr, deleteErr error
	service, user             string
	calls                     int
	setHook                   func()
	getHook                   func()
	deleteHook                func()
}

func TestKeyringPlatformErrorShapesUseConservativeStableStates(t *testing.T) {
	exitErr := platformExitError(t)
	tests := []struct {
		name, goos string
		raw        error
		want       CredentialStatus
	}{
		{"darwin security exit", "darwin", exitErr, StatusUnavailable},
		{"linux missing session bus", "linux", &os.PathError{Op: "dial", Path: "/private/socket", Err: syscall.ENOENT}, StatusUnavailable},
		{"linux dbus service unknown", "linux", errors.New("org.freedesktop.DBus.Error.ServiceUnknown"), StatusUnavailable},
		{"linux dbus access denied", "linux", errors.New("org.freedesktop.DBus.Error.AccessDenied"), StatusDenied},
		{"windows access denied", "windows", syscall.Errno(5), StatusDenied},
		{"windows no logon session", "windows", syscall.Errno(1312), StatusUnavailable},
		{"windows cancelled", "windows", syscall.Errno(1223), StatusDenied},
		{"windows not supported", "windows", syscall.Errno(50), StatusUnsupported},
		{"unknown ordinary error", "darwin", errors.New("unexpected opaque failure"), StatusFailure},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := classifyPlatformKeyringError(test.raw, test.goos); got != test.want {
				t.Fatalf("status = %q, want %q", got, test.want)
			}
		})
	}
}

func platformExitError(t *testing.T) *exec.ExitError {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=TestKeyringExitHelperProcess")
	command.Env = append(os.Environ(), "LUMINA_KEYRING_EXIT_HELPER=1")
	err := command.Run()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("expected ExitError, got %T %v", err, err)
	}
	return exitErr
}

func TestKeyringExitHelperProcess(t *testing.T) {
	if os.Getenv("LUMINA_KEYRING_EXIT_HELPER") != "1" {
		return
	}
	os.Exit(36)
}

func (f *fakeKeyring) Set(service, user, password string) error {
	f.calls++
	if f.setHook != nil {
		f.setHook()
	}
	f.service, f.user = service, user
	if f.setErr != nil {
		return f.setErr
	}
	if f.values == nil {
		f.values = map[string]string{}
	}
	f.values[user] = password
	return nil
}
func (f *fakeKeyring) Get(service, user string) (string, error) {
	f.calls++
	if f.getHook != nil {
		f.getHook()
	}
	f.service, f.user = service, user
	if f.getErr != nil {
		return "", f.getErr
	}
	v, ok := f.values[user]
	if !ok {
		return "", keyring.ErrNotFound
	}
	return v, nil
}
func (f *fakeKeyring) Delete(service, user string) error {
	f.calls++
	if f.deleteHook != nil {
		f.deleteHook()
	}
	f.service, f.user = service, user
	if f.deleteErr != nil {
		return f.deleteErr
	}
	if _, ok := f.values[user]; !ok {
		return keyring.ErrNotFound
	}
	delete(f.values, user)
	return nil
}

func TestKeyringStorePersistentLifecycleAndNamespace(t *testing.T) {
	b := &fakeKeyring{}
	s := newKeyringStore(b)
	secret := []byte("opaque\x00credential")
	if err := s.Put(context.Background(), "provider:primary", secret); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if b.service != keyringService || b.user != "provider:primary" {
		t.Fatalf("bad address: %q %q", b.service, b.user)
	}
	got, err := s.Get(context.Background(), "provider:primary")
	if err != nil || string(got) != string(secret) {
		t.Fatalf("Get=%q,%v", got, err)
	}
	status, err := s.Status(context.Background(), "provider:primary")
	if err != nil || status != StatusPersisted {
		t.Fatalf("Status=%q,%v", status, err)
	}
	if err := s.Delete(context.Background(), "provider:primary"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(context.Background(), "provider:primary"); err != nil {
		t.Fatalf("idempotent Delete: %v", err)
	}
	status, err = s.Status(context.Background(), "provider:primary")
	if err != nil || status != StatusMissing {
		t.Fatalf("missing=%q,%v", status, err)
	}
}

func TestKeyringStoreMapsEverySecureStoreState(t *testing.T) {
	tests := []struct {
		name string
		raw  error
		want CredentialStatus
	}{
		{"missing", keyring.ErrNotFound, StatusMissing},
		{"locked", errors.New("login keychain is locked"), StatusLocked},
		{"denied", errors.New("permission denied for user interaction"), StatusDenied},
		{"unavailable", errors.New("secret service is unavailable"), StatusUnavailable},
		{"unsupported", keyring.ErrUnsupportedPlatform, StatusUnsupported},
		{"other", errors.New("platform exploded"), StatusFailure},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := newKeyringStore(&fakeKeyring{getErr: tc.raw})
			status, err := s.Status(context.Background(), "provider:primary")
			if status != tc.want {
				t.Fatalf("got %q want %q", status, tc.want)
			}
			if tc.want == StatusMissing {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var se *StoreError
			if !errors.As(err, &se) || se.Status() != tc.want {
				t.Fatalf("bad typed error: %T %v", err, err)
			}
		})
	}
}

func TestKeyringStoreValidatesReferenceBeforeBackend(t *testing.T) {
	for _, ref := range []string{"", " leading", "slash/value", "line\nbreak", strings.Repeat("a", MaxCredentialRefBytes+1)} {
		b := &fakeKeyring{}
		if err := newKeyringStore(b).Put(context.Background(), ref, []byte("secret")); err == nil {
			t.Fatalf("accepted %q", ref)
		}
		if b.service != "" {
			t.Fatal("backend called")
		}
	}
}

func TestKeyringErrorsRedactSensitiveDetails(t *testing.T) {
	ref, secret := "provider:sensitive-reference", "top-secret-value"
	raw := errors.New("platform failure included " + ref + " " + secret)
	err := newKeyringStore(&fakeKeyring{setErr: raw}).Put(context.Background(), ref, []byte(secret))
	if err == nil {
		t.Fatal("expected error")
	}
	for _, bad := range []string{ref, secret, raw.Error()} {
		if strings.Contains(err.Error(), bad) {
			t.Fatalf("leak: %q", err)
		}
	}
}
