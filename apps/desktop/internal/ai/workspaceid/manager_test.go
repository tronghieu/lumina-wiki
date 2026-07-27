package workspaceid

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAttachDecisionsAndStableIdentity(t *testing.T) {
	base := t.TempDir()
	now := time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC)
	signatures := map[string]Signature{}
	m := testManager(t, base, &now, signatures)

	one := makeWorkspace(t)
	signatures[one] = "device:a:file:1"
	first, err := m.BeginAttach(one)
	if err != nil || first.Kind != AttachNew || first.Token == "" {
		t.Fatalf("new decision = %#v, %v", first, err)
	}
	id, err := m.ConfirmAttach(first.Token)
	if err != nil || !id.Valid() {
		t.Fatalf("confirm new = %q, %v", id, err)
	}

	known, err := m.BeginAttach(one)
	if err != nil || known.Kind != AttachKnown {
		t.Fatalf("known decision = %#v, %v", known, err)
	}
	knownID, err := m.ConfirmAttach(known.Token)
	if err != nil || knownID != id {
		t.Fatalf("known confirm = %q, %v; want %q", knownID, err, id)
	}

	two := makeWorkspace(t)
	signatures[two] = signatures[one]
	rename, err := m.BeginAttach(two)
	if err != nil || rename.Kind != AttachRenameConfirmationRequired {
		t.Fatalf("rename decision = %#v, %v", rename, err)
	}
	renameID, err := m.ConfirmAttach(rename.Token)
	if err != nil || renameID != id {
		t.Fatalf("rename confirm = %q, %v; want %q", renameID, err, id)
	}

	signatures[two] = "device:a:file:2"
	reuse, err := m.BeginAttach(two)
	if err != nil || reuse.Kind != AttachPathReuseConfirmationRequired {
		t.Fatalf("reuse decision = %#v, %v", reuse, err)
	}
	reuseID, err := m.ConfirmAttach(reuse.Token)
	if err != nil || reuseID == id || !reuseID.Valid() {
		t.Fatalf("reuse confirm = %q, %v; old %q", reuseID, err, id)
	}
}

func TestAmbiguityAndTokenLifecycleNeverAutoAttach(t *testing.T) {
	base := t.TempDir()
	now := time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC)
	signatures := map[string]Signature{}
	m := testManager(t, base, &now, signatures)
	root := makeWorkspace(t)

	decision, err := m.BeginAttach(root)
	if err != nil || decision.Kind != AttachAmbiguousConfirmationRequired {
		t.Fatalf("missing signature decision = %#v, %v", decision, err)
	}
	if err := m.CancelAttach(decision.Token); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := m.ConfirmAttach(decision.Token); !errors.Is(err, ErrInvalidDecisionToken) {
		t.Fatalf("cancelled token error = %v", err)
	}

	expiring, _ := m.BeginAttach(root)
	now = now.Add(DefaultDecisionTTL)
	if _, err := m.ConfirmAttach(expiring.Token); !errors.Is(err, ErrInvalidDecisionToken) {
		t.Fatalf("expired token error = %v", err)
	}

	fresh, _ := m.BeginAttach(root)
	if _, err := m.ConfirmAttach(fresh.Token); err != nil {
		t.Fatalf("fresh confirm: %v", err)
	}
	if _, err := m.ConfirmAttach(fresh.Token); !errors.Is(err, ErrInvalidDecisionToken) {
		t.Fatalf("reused token error = %v", err)
	}
	restarted := testManager(t, base, &now, signatures)
	restartToken, _ := m.BeginAttach(root)
	if _, err := restarted.ConfirmAttach(restartToken.Token); !errors.Is(err, ErrInvalidDecisionToken) {
		t.Fatalf("restart token error = %v", err)
	}
}

func TestCanonicalizationRejectsUnsafeRootsAndResolvesSymlinkAlias(t *testing.T) {
	base := t.TempDir()
	m, err := NewManager(base, Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{"", ".", "relative"} {
		if _, err := m.BeginAttach(root); err == nil {
			t.Fatalf("expected %q rejection", root)
		}
	}
	file := filepath.Join(t.TempDir(), "file")
	_ = os.WriteFile(file, []byte("x"), 0o600)
	if _, err := m.BeginAttach(file); err == nil {
		t.Fatal("expected file rejection")
	}
	root := makeWorkspace(t)
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(root, alias); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	d1, err := m.BeginAttach(alias)
	if err != nil {
		t.Fatal(err)
	}
	expected, _ := filepath.EvalSymlinks(root)
	if d1.CanonicalPath != filepath.Clean(expected) {
		t.Fatalf("canonical path = %q, want %q", d1.CanonicalPath, expected)
	}
}

func TestRegistryStrictPersistenceAndSafety(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	m := testManager(t, base, &now, sigs)
	root := makeWorkspace(t)
	sigs[root] = "sig"
	d, _ := m.BeginAttach(root)
	if _, err := m.ConfirmAttach(d.Token); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(m.store.path)
	if err != nil || !bytes.HasSuffix(raw, []byte("\n")) {
		t.Fatalf("registry bytes: %q, %v", raw, err)
	}
	if strings.Contains(string(raw), `"schemaVersion": 0`) {
		t.Fatal("registry schema was not versioned")
	}
	if info, _ := os.Stat(m.store.path); info.Mode().Perm() != 0o600 {
		t.Fatalf("registry mode = %o", info.Mode().Perm())
	}
	if info, _ := os.Stat(m.store.dir); info.Mode().Perm() != 0o700 {
		t.Fatalf("registry dir mode = %o", info.Mode().Perm())
	}

	badCases := []string{
		`{bad`,
		`{"schemaVersion":99,"records":[]}`,
		`{"schemaVersion":1,"schemaVersion":1,"records":[]}`,
		`{"schemaVersion":1,"records":[],"extra":true}`,
	}
	for _, bad := range badCases {
		if err := os.WriteFile(m.store.path, []byte(bad), 0o600); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(m.store.path)
		if _, err := m.store.Load(); err == nil {
			t.Fatalf("accepted %s", bad)
		}
		after, _ := os.ReadFile(m.store.path)
		if !bytes.Equal(before, after) {
			t.Fatal("failed load changed original")
		}
	}
}

func TestConcurrentConfirmsAndBusyLock(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	m := testManager(t, base, &now, sigs)
	root := makeWorkspace(t)
	sigs[root] = "sig"
	d1, _ := m.BeginAttach(root)
	d2, _ := m.BeginAttach(root)
	var wg sync.WaitGroup
	ids := make(chan WorkspaceID, 2)
	for _, token := range []string{d1.Token, d2.Token} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, err := m.ConfirmAttach(token)
			if err == nil {
				ids <- id
			}
		}()
	}
	wg.Wait()
	close(ids)
	var first WorkspaceID
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Fatalf("racing IDs differ: %q %q", first, id)
		}
	}

}

func TestSignatureCollisionRequiresAmbiguousConfirmation(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	m := testManager(t, base, &now, sigs)
	one, two, three := makeWorkspace(t), makeWorkspace(t), makeWorkspace(t)
	sigs[one] = "shared"
	d, _ := m.BeginAttach(one)
	if _, err := m.ConfirmAttach(d.Token); err != nil {
		t.Fatal(err)
	}
	d, _ = m.BeginAttach(two) // unavailable: accepted as a distinct ambiguous root
	if _, err := m.ConfirmAttach(d.Token); err != nil {
		t.Fatal(err)
	}
	sigs[two] = "shared"
	d, _ = m.BeginAttach(two) // path reuse gives the second active shared signature
	if _, err := m.ConfirmAttach(d.Token); err != nil {
		t.Fatal(err)
	}
	sigs[three] = "shared"
	d, err := m.BeginAttach(three)
	if err != nil || d.Kind != AttachAmbiguousConfirmationRequired {
		t.Fatalf("collision decision = %#v, %v", d, err)
	}
}

func TestAtomicFailurePreservesOldRegistryAndCleansTemporaryFile(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	m := testManager(t, base, &now, sigs)
	root := makeWorkspace(t)
	sigs[root] = "sig"
	d, _ := m.BeginAttach(root)
	if _, err := m.ConfirmAttach(d.Token); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(m.store.path)
	m.store.rename = func(string, string) error { return errors.New("raw private path " + root) }
	d, _ = m.BeginAttach(root)
	if _, err := m.ConfirmAttach(d.Token); err == nil || strings.Contains(err.Error(), root) {
		t.Fatalf("expected sanitized commit error, got %v", err)
	}
	after, _ := os.ReadFile(m.store.path)
	if !bytes.Equal(before, after) {
		t.Fatal("failed atomic save replaced old registry")
	}
	temps, _ := filepath.Glob(filepath.Join(m.store.dir, "."+registryFileName+".tmp-*"))
	if len(temps) != 0 {
		t.Fatalf("temporary files remain: %v", temps)
	}
}

func TestErrorsDoNotExposePrivatePathsOrInjectedDetails(t *testing.T) {
	private := filepath.Join(t.TempDir(), "personal-name")
	m, err := NewManager(t.TempDir(), Options{
		Canonicalizer: func(string) (string, error) { return "", errors.New("raw " + private) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.BeginAttach(private); err == nil || strings.Contains(err.Error(), private) || strings.Contains(err.Error(), "raw") {
		t.Fatalf("unsafe error = %v", err)
	}
}

func TestAttachDoesNotChangeWorkspaceBytes(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	sigs := map[string]Signature{}
	m := testManager(t, base, &now, sigs)
	root := makeWorkspace(t)
	file := filepath.Join(root, "user-note.md")
	if err := os.WriteFile(file, []byte("unchanged"), 0o600); err != nil {
		t.Fatal(err)
	}
	sigs[root] = "sig"
	before, _ := os.ReadFile(file)
	d, err := m.BeginAttach(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.ConfirmAttach(d.Token); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(file)
	if !bytes.Equal(before, after) {
		t.Fatal("attach changed workspace bytes")
	}
}

func TestBoundsDecisionsRecordsAndRegistryFile(t *testing.T) {
	now := time.Now().UTC()
	m, err := NewManager(t.TempDir(), Options{
		Clock: func() time.Time { return now }, MaxDecisions: 2,
		Canonicalizer:  func(path string) (string, error) { return path, nil },
		SignatureProbe: func(string) (Signature, bool, error) { return "", false, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 3; index++ {
		root := makeWorkspace(t)
		if _, err := m.BeginAttach(root); err != nil {
			t.Fatal(err)
		}
	}
	if len(m.pending) != 2 {
		t.Fatalf("pending decisions = %d", len(m.pending))
	}
	store, err := newRegistryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ensureDir(true); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.path, []byte(strings.Repeat("x", MaxRegistryBytes+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("oversized registry accepted")
	}
	registry := emptyRegistry()
	registry.Records = make([]Record, MaxRegistryRecords+1)
	if err := store.Save(registry); err == nil {
		t.Fatal("oversized record set accepted")
	}
}

func testManager(t *testing.T, base string, now *time.Time, signatures map[string]Signature) *Manager {
	t.Helper()
	sequence := byte(1)
	m, err := NewManager(base, Options{
		Clock:         func() time.Time { return *now },
		Canonicalizer: func(path string) (string, error) { return filepath.Clean(path), nil },
		Random: func(p []byte) error {
			for i := range p {
				p[i] = sequence
			}
			sequence++
			return nil
		},
		SignatureProbe: func(path string) (Signature, bool, error) { sig, ok := signatures[path]; return sig, ok, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func makeWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	abs, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Clean(abs)
}
