package workspaceid

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResolveRecentReturnsPathlessActiveRecordsInRequestedOrder(t *testing.T) {
	base := t.TempDir()
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	signatures := map[string]Signature{}
	manager := testManager(t, base, &now, signatures)
	firstRoot := makeWorkspace(t)
	secondRoot := makeWorkspace(t)
	signatures[firstRoot] = "first"
	signatures[secondRoot] = "second"
	firstID := attachWorkspace(t, manager, firstRoot)
	now = now.Add(time.Minute)
	secondID := attachWorkspace(t, manager, secondRoot)

	recent, err := manager.ResolveRecent([]WorkspaceID{secondID, firstID})
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 2 || recent[0].WorkspaceID != secondID || recent[1].WorkspaceID != firstID {
		t.Fatalf("recent order = %#v", recent)
	}
	if recent[0].Label != filepath.Base(secondRoot) || recent[1].Label != filepath.Base(firstRoot) {
		t.Fatalf("recent labels = %#v", recent)
	}
	raw, err := json.Marshal(recent)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), firstRoot) || strings.Contains(string(raw), secondRoot) ||
		strings.Contains(string(raw), "canonicalPath") {
		t.Fatalf("recent DTO leaked paths: %s", raw)
	}
}

func TestResolveRecentRejectsInvalidOrDuplicateIDsAndOmitsInactive(t *testing.T) {
	base := t.TempDir()
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	signatures := map[string]Signature{}
	manager := testManager(t, base, &now, signatures)
	root := makeWorkspace(t)
	signatures[root] = "first"
	oldID := attachWorkspace(t, manager, root)
	signatures[root] = "replacement"
	replacement, err := manager.BeginAttach(root)
	if err != nil || replacement.Kind != AttachPathReuseConfirmationRequired {
		t.Fatalf("replacement decision = %#v, %v", replacement, err)
	}
	if _, err := manager.ConfirmAttach(replacement.Token); err != nil {
		t.Fatal(err)
	}

	recent, err := manager.ResolveRecent([]WorkspaceID{oldID})
	if err != nil || len(recent) != 0 {
		t.Fatalf("inactive recent = %#v, %v", recent, err)
	}
	if _, err := manager.ResolveRecent([]WorkspaceID{"invalid"}); !errors.Is(err, ErrInvalidRecentWorkspace) {
		t.Fatalf("invalid ID = %v", err)
	}
	if _, err := manager.ResolveRecent([]WorkspaceID{oldID, oldID}); !errors.Is(err, ErrInvalidRecentWorkspace) {
		t.Fatalf("duplicate IDs = %v", err)
	}
}

func TestBeginRestoreReopensSavedPathAndPreservesRestartConfirmation(t *testing.T) {
	base := t.TempDir()
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	signatures := map[string]Signature{}
	first := testManager(t, base, &now, signatures)
	root := makeWorkspace(t)
	signatures[root] = "stable"
	id := attachWorkspace(t, first, root)

	restarted := testManager(t, base, &now, signatures)
	decision, err := restarted.BeginRestore(id)
	if err != nil || decision.Kind != AttachIdentityConfirmationRequired {
		t.Fatalf("restore decision = %#v, %v", decision, err)
	}
	if decision.CanonicalPath != root {
		t.Fatalf("restore reopened %q, want %q", decision.CanonicalPath, root)
	}
	if err := restarted.CancelAttach(decision.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.ConfirmAttach(decision.Token); !errors.Is(err, ErrInvalidDecisionToken) {
		t.Fatalf("cancelled restore token = %v", err)
	}

	decision, err = restarted.BeginRestore(id)
	if err != nil {
		t.Fatal(err)
	}
	confirmed, err := restarted.ConfirmAttach(decision.Token)
	if err != nil || confirmed != id {
		t.Fatalf("confirmed restore = %q, %v", confirmed, err)
	}
}

func TestBeginRestoreRejectsUnknownInactiveMissingAndReplacedLibraries(t *testing.T) {
	t.Run("unknown", func(t *testing.T) {
		manager, err := newTestManager(t, t.TempDir(), Options{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.BeginRestore("ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); !errors.Is(err, ErrRecentWorkspaceUnknown) {
			t.Fatalf("unknown restore = %v", err)
		}
		if _, err := manager.BeginRestore("invalid"); !errors.Is(err, ErrInvalidRecentWorkspace) {
			t.Fatalf("invalid restore = %v", err)
		}
	})

	t.Run("inactive", func(t *testing.T) {
		base := t.TempDir()
		now := time.Now().UTC()
		signatures := map[string]Signature{}
		manager := testManager(t, base, &now, signatures)
		root := makeWorkspace(t)
		signatures[root] = "old"
		oldID := attachWorkspace(t, manager, root)
		signatures[root] = "new"
		decision, err := manager.BeginAttach(root)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.ConfirmAttach(decision.Token); err != nil {
			t.Fatal(err)
		}
		if _, err := manager.BeginRestore(oldID); !errors.Is(err, ErrRecentWorkspaceInactive) {
			t.Fatalf("inactive restore = %v", err)
		}
	})

	t.Run("missing", func(t *testing.T) {
		base := t.TempDir()
		now := time.Now().UTC()
		signatures := map[string]Signature{}
		manager := testManager(t, base, &now, signatures)
		root := makeWorkspace(t)
		signatures[root] = "stable"
		id := attachWorkspace(t, manager, root)
		if err := manager.Close(); err != nil {
			t.Fatal(err)
		}
		if err := os.RemoveAll(root); err != nil {
			t.Fatal(err)
		}
		restarted := testManager(t, base, &now, signatures)
		if _, err := restarted.BeginRestore(id); !errors.Is(err, ErrRecentWorkspaceUnavailable) {
			t.Fatalf("missing restore = %v", err)
		}
	})

	t.Run("replaced", func(t *testing.T) {
		base := t.TempDir()
		now := time.Now().UTC()
		signatures := map[string]Signature{}
		manager := testManager(t, base, &now, signatures)
		root := makeWorkspace(t)
		signatures[root] = "old"
		id := attachWorkspace(t, manager, root)
		signatures[root] = "replacement"
		restarted := testManager(t, base, &now, signatures)
		if _, err := restarted.BeginRestore(id); !errors.Is(err, ErrRecentWorkspaceChanged) {
			t.Fatalf("replaced restore = %v", err)
		}
	})
}

func TestBeginFindPreservesOnlyTheUniquelyMatchedRecentIdentity(t *testing.T) {
	base := t.TempDir()
	now := time.Now().UTC()
	signatures := map[string]Signature{}
	manager := testManager(t, base, &now, signatures)
	original := makeWorkspace(t)
	signatures[original] = "stable"
	id := attachWorkspace(t, manager, original)
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	moved := original + "-moved"
	if err := os.Rename(original, moved); err != nil {
		t.Fatal(err)
	}
	signatures[moved] = "stable"
	manager = testManager(t, base, &now, signatures)

	decision, err := manager.BeginFind(id, moved)
	if err != nil || decision.Kind != AttachRenameConfirmationRequired {
		t.Fatalf("find decision = %#v, %v", decision, err)
	}
	confirmed, err := manager.ConfirmAttach(decision.Token)
	if err != nil || confirmed != id {
		t.Fatalf("confirmed find = %q, %v", confirmed, err)
	}

	replacement := makeWorkspace(t)
	signatures[replacement] = "different"
	if _, err := manager.BeginFind(id, replacement); !errors.Is(err, ErrRecentWorkspaceChanged) {
		t.Fatalf("replacement find = %v", err)
	}
	if _, err := manager.BeginFind(id, filepath.Join(t.TempDir(), "missing")); !errors.Is(
		err, ErrRecentWorkspaceUnavailable,
	) {
		t.Fatalf("missing find = %v", err)
	}
}

func attachWorkspace(t *testing.T, manager *Manager, root string) WorkspaceID {
	t.Helper()
	decision, err := manager.BeginAttach(root)
	if err != nil {
		t.Fatal(err)
	}
	id, err := manager.ConfirmAttach(decision.Token)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
