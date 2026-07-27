package workspaceid

import (
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRestartExactDurableMatchRequiresIdentityConfirmation(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	root := makeWorkspace(t)
	sigs[root] = "reusable"
	first := testManager(t, base, &now, sigs)
	d, _ := first.BeginAttach(root)
	id, err := first.ConfirmAttach(d.Token)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := first.BeginAttach(root)
	if err != nil || reopened.Kind != AttachKnown {
		t.Fatalf("same manager = %#v, %v", reopened, err)
	}
	if got, err := first.ConfirmAttach(reopened.Token); err != nil || got != id {
		t.Fatalf("same manager ID = %q, %v", got, err)
	}

	restarted := testManagerWithSeed(t, base, &now, sigs, 90)
	d, err = restarted.BeginAttach(root)
	if err != nil || d.Kind != AttachIdentityConfirmationRequired {
		t.Fatalf("restart = %#v, %v", d, err)
	}
	if got, err := restarted.ConfirmAttach(d.Token); err != nil || got != id {
		t.Fatalf("restart confirm = %q, %v", got, err)
	}
}

func TestMissingSignatureExactPathRetainsExistingIdentity(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	root := makeWorkspace(t)
	first := testManager(t, base, &now, sigs)
	d, _ := first.BeginAttach(root)
	id, err := first.ConfirmAttach(d.Token)
	if err != nil {
		t.Fatal(err)
	}
	restarted := testManagerWithSeed(t, base, &now, sigs, 70)
	d, err = restarted.BeginAttach(root)
	if err != nil || d.Kind != AttachIdentityConfirmationRequired {
		t.Fatalf("missing signature exact = %#v, %v", d, err)
	}
	if got, err := restarted.ConfirmAttach(d.Token); err != nil || got != id {
		t.Fatalf("identity changed: %q != %q, %v", got, id, err)
	}
}

func TestPendingHandleDetectsDirectoryReplacementAndCloses(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("open directory replacement semantics differ")
	}
	base := t.TempDir()
	root := makeWorkspace(t)
	m, err := NewManager(base, Options{})
	if err != nil {
		t.Fatal(err)
	}
	d, err := m.BeginAttach(root)
	if err != nil {
		t.Fatal(err)
	}
	replaced := root + "-old"
	if err := os.Rename(root, replaced); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ConfirmAttach(d.Token); !errors.Is(err, ErrCandidateChanged) {
		t.Fatalf("replacement = %v", err)
	}
	registry, err := m.store.Load()
	if err != nil || len(registry.Records) != 0 {
		t.Fatalf("replacement mutated registry: %#v, %v", registry, err)
	}
}

type trackedDirectoryHandle struct {
	DirectoryHandle
	closes int
}

func (handle *trackedDirectoryHandle) Close() error {
	handle.closes++
	return handle.DirectoryHandle.Close()
}

func TestSamplingReplacementFailsAndClosesHandleOnce(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("open directory replacement semantics differ")
	}
	root := makeWorkspace(t)
	var tracked *trackedDirectoryHandle
	m, err := NewManager(t.TempDir(), Options{
		OpenDirectory: func(path string) (DirectoryHandle, error) {
			file, err := os.Open(path)
			tracked = &trackedDirectoryHandle{DirectoryHandle: file}
			return tracked, err
		},
		HandleSignature: func(DirectoryHandle) (Signature, bool, error) {
			if err := os.Rename(root, root+"-old"); err != nil {
				return "", false, err
			}
			if err := os.Mkdir(root, 0o700); err != nil {
				return "", false, err
			}
			return "sample", true, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.BeginAttach(root); !errors.Is(err, ErrCandidateChanged) {
		t.Fatalf("sampling replacement = %v", err)
	}
	if tracked == nil || tracked.closes != 1 {
		t.Fatalf("handle closes = %#v", tracked)
	}
}

func TestMalformedAndHugeTokensRejectedBeforeLookup(t *testing.T) {
	m, err := NewManager(t.TempDir(), Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"", "not+rawurl", base64.RawURLEncoding.EncodeToString([]byte("short")), strings.Repeat("a", 10000)} {
		if _, err := m.ConfirmAttach(token); !errors.Is(err, ErrInvalidDecisionToken) {
			t.Fatalf("token %q: %v", token[:min(len(token), 20)], err)
		}
		if err := m.CancelAttach(token); !errors.Is(err, ErrInvalidDecisionToken) {
			t.Fatalf("cancel malformed: %v", err)
		}
	}
}

func TestCrashLeftLockIsRecovered(t *testing.T) {
	if base := os.Getenv("WORKSPACEID_CRASH_LOCK"); base != "" {
		store, err := newRegistryStore(base)
		if err != nil {
			os.Exit(2)
		}
		if _, err := store.acquireLock(); err != nil {
			os.Exit(3)
		}
		os.Exit(0)
	}
	base := t.TempDir()
	command := exec.Command(os.Args[0], "-test.run=TestCrashLeftLockIsRecovered")
	command.Env = append(os.Environ(), "WORKSPACEID_CRASH_LOCK="+base)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("crash helper: %v: %s", err, output)
	}
	store, _ := newRegistryStore(base)
	if _, err := os.Stat(store.lockPath); err != nil {
		t.Fatalf("crash removed persistent lock: %v", err)
	}
	release, err := store.acquireLock()
	if err != nil {
		t.Fatalf("recover crashed owner: %v", err)
	}
	release()
	if _, err := os.Stat(store.lockPath); err != nil {
		t.Fatalf("release removed persistent lock: %v", err)
	}
}

func TestCompactionKeepsRegistryBoundedAcrossPathReuse(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	root := makeWorkspace(t)
	m := testManager(t, base, &now, sigs)
	var last WorkspaceID
	for index := 0; index < 300; index++ {
		sigs[root] = Signature("sig-" + strings.Repeat("x", index%10) + string(rune('A'+index%26)))
		d, err := m.BeginAttach(root)
		if err != nil {
			t.Fatalf("begin %d: %v", index, err)
		}
		if index > 0 && d.Kind == AttachKnown {
			t.Fatalf("reuse %d silently known", index)
		}
		last, err = m.ConfirmAttach(d.Token)
		if err != nil {
			t.Fatalf("confirm %d: %v", index, err)
		}
	}
	registry, err := m.store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(registry.Records) > MaxRegistryRecords {
		t.Fatalf("records = %d", len(registry.Records))
	}
	active := 0
	for _, record := range registry.Records {
		if record.Active {
			active++
			if record.WorkspaceID != last {
				t.Fatal("active identity was not latest")
			}
		}
	}
	if active != 1 {
		t.Fatalf("active records = %d", active)
	}
}
