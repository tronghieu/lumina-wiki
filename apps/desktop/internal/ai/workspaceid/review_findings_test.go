package workspaceid

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestClassifyCandidateRejectsAmbiguousAndContradictoryEvidence(t *testing.T) {
	pathA, pathB, pathC := absoluteTestPath("a"), absoluteTestPath("b"), absoluteTestPath("c")
	record := func(id, path string, signature Signature) Record {
		return Record{WorkspaceID: WorkspaceID(id), CanonicalPath: path, FilesystemSignature: signature, Active: true}
	}
	tests := []struct {
		name      string
		records   []Record
		candidate Candidate
		want      AttachKind
		index     int
	}{
		{"exact", []Record{record("ws_11111111111111111111111111111111", pathA, "s1")}, Candidate{pathA, "s1", true}, AttachIdentityConfirmationRequired, 0},
		{"rename", []Record{record("ws_11111111111111111111111111111111", pathA, "s1")}, Candidate{pathB, "s1", true}, AttachRenameConfirmationRequired, 0},
		{"reuse", []Record{record("ws_11111111111111111111111111111111", pathA, "s1")}, Candidate{pathA, "s2", true}, AttachPathReuseConfirmationRequired, 0},
		{"new", []Record{record("ws_11111111111111111111111111111111", pathA, "s1")}, Candidate{pathB, "s2", true}, AttachNew, -1},
		{"missing signature", nil, Candidate{pathC, "", false}, AttachAmbiguousConfirmationRequired, -1},
		{"duplicate path", []Record{record("ws_11111111111111111111111111111111", pathA, "s1"), record("ws_22222222222222222222222222222222", pathA, "s2")}, Candidate{pathA, "s3", true}, AttachAmbiguousConfirmationRequired, -1},
		{"signature collision", []Record{record("ws_11111111111111111111111111111111", pathA, "s1"), record("ws_22222222222222222222222222222222", pathB, "s1")}, Candidate{pathC, "s1", true}, AttachAmbiguousConfirmationRequired, -1},
		{"contradiction", []Record{record("ws_11111111111111111111111111111111", pathA, "s1"), record("ws_22222222222222222222222222222222", pathB, "s2")}, Candidate{pathA, "s2", true}, AttachAmbiguousConfirmationRequired, -1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			kind, index := classifyCandidate(Registry{Records: test.records}, test.candidate)
			if kind != test.want || index != test.index {
				t.Fatalf("got %s/%d, want %s/%d", kind, index, test.want, test.index)
			}
		})
	}
}

func TestDecisionConflictsOnUnrelatedDurableChange(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	first := testManager(t, base, &now, sigs)
	second := testManagerWithSeed(t, base, &now, sigs, 80)
	rootA, rootB := makeWorkspace(t), makeWorkspace(t)
	sigs[rootA], sigs[rootB] = "a", "b"
	pending, err := first.BeginAttach(rootA)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := second.BeginAttach(rootB)
	if _, err := second.ConfirmAttach(other.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := first.ConfirmAttach(pending.Token); !errors.Is(err, ErrRegistryConflict) {
		t.Fatalf("conflict error = %v", err)
	}
	if _, err := first.ConfirmAttach(pending.Token); !errors.Is(err, ErrInvalidDecisionToken) {
		t.Fatalf("conflict token was not consumed: %v", err)
	}
}

func TestDecisionConflictsWhenSameKindTargetsDifferentIdentity(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	seed := testManagerWithSeed(t, base, &now, sigs, 1)
	original, renamed := makeWorkspace(t), makeWorkspace(t)
	sigs[original] = "shared"
	d, _ := seed.BeginAttach(original)
	if _, err := seed.ConfirmAttach(d.Token); err != nil {
		t.Fatal(err)
	}
	first := testManagerWithSeed(t, base, &now, sigs, 40)
	pending, _ := first.BeginAttach(renamed)
	registry, err := first.store.Load()
	if err != nil {
		t.Fatal(err)
	}
	registry.Records[0].Active = false
	registry.Records = append(registry.Records, Record{SchemaVersion: 1, WorkspaceID: "ws_99999999999999999999999999999999", CanonicalPath: absoluteTestPath("other"), FilesystemSignature: "shared", FirstSeenAt: now, LastSeenAt: now, Active: true})
	if err := first.store.Save(registry); err != nil {
		t.Fatal(err)
	}
	if kind, _ := classifyCandidate(registry, Candidate{renamed, "shared", true}); kind != AttachRenameConfirmationRequired {
		t.Fatalf("setup kind = %s", kind)
	}
	if _, err := first.ConfirmAttach(pending.Token); !errors.Is(err, ErrRegistryConflict) {
		t.Fatalf("target conflict = %v", err)
	}
}

func TestLoadRejectsUnsafePermissionsAndSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows ACLs are not represented by Unix mode bits")
	}
	base := t.TempDir()
	store, _ := newRegistryStore(base)
	if _, err := store.ensureDir(true); err != nil {
		t.Fatal(err)
	}
	raw, _ := encodeRegistry(emptyRegistry())
	if err := os.WriteFile(store.path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(store.dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("permissive registry leaf accepted")
	}
	if err := os.Chmod(store.dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(store.path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("permissive registry file accepted")
	}

	outside := t.TempDir()
	symlinkStore, _ := newRegistryStore(t.TempDir())
	if err := os.Symlink(outside, symlinkStore.dir); err == nil {
		if _, err := symlinkStore.Load(); err == nil {
			t.Fatal("symlink leaf accepted")
		}
	}
	fileStore, _ := newRegistryStore(t.TempDir())
	if _, err := fileStore.ensureDir(true); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(outside, "registry.json")
	if err := os.WriteFile(target, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, fileStore.path); err == nil {
		if _, err := fileStore.Load(); err == nil {
			t.Fatal("symlink file accepted")
		}
	}
}

func TestStrictCanonicalPathValidation(t *testing.T) {
	valid := absoluteTestPath("clean")
	invalid := []string{"", "relative", valid + string(filepath.Separator) + ".." + string(filepath.Separator) + "clean", valid + "\x00bad", strings.Repeat("/x", MaxCanonicalPathBytes)}
	for _, path := range invalid {
		if validCanonicalPath(path) {
			t.Fatalf("accepted canonical path %q", path)
		}
	}
	m, err := NewManager(t.TempDir(), Options{Canonicalizer: func(string) (string, error) { return valid + string(filepath.Separator) + ".", nil }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.BeginAttach(valid); err == nil {
		t.Fatal("non-clean injected canonical path accepted")
	}
	registry := emptyRegistry()
	registry.Records = []Record{{SchemaVersion: 1, WorkspaceID: "ws_11111111111111111111111111111111", CanonicalPath: valid + string(filepath.Separator) + ".", FilesystemSignature: "sig", FirstSeenAt: time.Now(), LastSeenAt: time.Now(), Active: true}}
	if err := registry.validate(); err == nil {
		t.Fatal("non-clean registry path accepted")
	}
}

func TestIndependentManagersSeeBusyLock(t *testing.T) {
	base := t.TempDir()
	one, _ := NewManager(base, Options{})
	two, _ := NewManager(base, Options{})
	release, err := one.store.acquireLock()
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err := two.store.acquireLock(); !errors.Is(err, ErrRegistryBusy) {
		t.Fatalf("busy lock = %v", err)
	}
}

func TestDirectorySyncFailureIsBestEffortAfterMandatoryRename(t *testing.T) {
	store, _ := newRegistryStore(t.TempDir())
	if _, err := store.ensureDir(true); err != nil {
		t.Fatal(err)
	}
	renamed := false
	store.rename = func(from, to string) error { renamed = true; return os.Rename(from, to) }
	store.syncDir = func(string) error { return errors.New("unsupported directory sync") }
	if err := store.Save(emptyRegistry()); err != nil {
		t.Fatalf("post-commit directory sync must be non-fatal: %v", err)
	}
	if !renamed {
		t.Fatal("registry was not renamed")
	}
}

func TestFullWorkspaceTreeManifestUnchangedByAllDecisionFlows(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	m := testManager(t, base, &now, sigs)
	root := makeWorkspace(t)
	if err := os.Mkdir(filepath.Join(root, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "note"), []byte("content"), 0o600); err != nil {
		t.Fatal(err)
	}
	sigs[root] = "sig"
	before := treeManifest(t, root)
	cancelled, _ := m.BeginAttach(root)
	if err := m.CancelAttach(cancelled.Token); err != nil {
		t.Fatal(err)
	}
	confirmed, _ := m.BeginAttach(root)
	if _, err := m.ConfirmAttach(confirmed.Token); err != nil {
		t.Fatal(err)
	}
	after := treeManifest(t, root)
	if !bytes.Equal(before, after) {
		t.Fatal("workspace tree manifest changed")
	}
}

func treeManifest(t *testing.T, root string) []byte {
	t.Helper()
	var entries []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		line := rel + ":" + info.Mode().String()
		if info.Mode().IsRegular() {
			raw, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			line += ":" + string(raw)
		}
		entries = append(entries, line)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(entries)
	return []byte(strings.Join(entries, "\n"))
}

func absoluteTestPath(name string) string {
	return filepath.Join(string(filepath.Separator), "workspaceid-test", name)
}

func testManagerWithSeed(t *testing.T, base string, now *time.Time, signatures map[string]Signature, seed byte) *Manager {
	t.Helper()
	sequence := seed
	m, err := NewManager(base, Options{Clock: func() time.Time { return *now }, Canonicalizer: func(path string) (string, error) { return filepath.Clean(path), nil }, Random: func(p []byte) error {
		for i := range p {
			p[i] = sequence
		}
		sequence++
		return nil
	}, SignatureProbe: func(path string) (Signature, bool, error) { sig, ok := signatures[path]; return sig, ok, nil }})
	if err != nil {
		t.Fatal(err)
	}
	return m
}
