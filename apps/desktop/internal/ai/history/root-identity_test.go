package history

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestHistoryRootReplacementBetweenLstatAndOpenRootIsRejected(t *testing.T) {
	store := newTestStore(t)
	if _, err := store.ensureDirs(true); err != nil {
		t.Fatalf("seed dirs: %v", err)
	}
	moved, outside := store.historyDir+".moved", t.TempDir()
	store.historyOpenHook = func() {
		if err := os.Rename(store.historyDir, moved); err != nil {
			t.Fatalf("rename history: %v", err)
		}
		if err := os.Symlink(outside, store.historyDir); err != nil {
			t.Fatalf("symlink history: %v", err)
		}
	}
	if err := store.SetEnabled(context.Background(), true); err == nil {
		t.Fatal("expected history-root identity rejection")
	}
	if _, err := os.Lstat(filepath.Join(outside, "state.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("outside history was accessed")
	}
}

func TestDesktopChildReplacementBeforeOpenRootHasNoOutsideProtectionSideEffect(t *testing.T) {
	store := newTestStore(t)
	if _, err := store.ensureDirs(true); err != nil {
		t.Fatalf("seed dirs: %v", err)
	}
	desktop := filepath.Dir(store.historyDir)
	moved, outside := desktop+".moved", t.TempDir()
	if err := os.Chmod(outside, 0o755); err != nil {
		t.Fatalf("chmod outside: %v", err)
	}
	store.desktopOpenHook = func() {
		if err := os.Rename(desktop, moved); err != nil {
			t.Fatalf("rename desktop: %v", err)
		}
		if err := os.Symlink(outside, desktop); err != nil {
			t.Fatalf("symlink desktop: %v", err)
		}
	}
	if err := store.SetEnabled(context.Background(), true); err == nil {
		t.Fatal("expected desktop identity rejection")
	}
	info, _ := os.Stat(outside)
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("outside mode changed to %o", info.Mode().Perm())
	}
}

func TestWorkspaceReplacementBetweenLstatAndOpenRootIsRejected(t *testing.T) {
	store := enabledTestStore(t)
	moved, outside := store.workspaceDir+".moved", t.TempDir()
	store.workspaceOpenHook = func() {
		if err := os.Rename(store.workspaceDir, moved); err != nil {
			t.Fatalf("rename workspace: %v", err)
		}
		if err := os.Symlink(outside, store.workspaceDir); err != nil {
			t.Fatalf("symlink workspace: %v", err)
		}
	}
	if _, err := store.Append(context.Background(), validRecord("conversation-a", "attempt-a")); err == nil {
		t.Fatal("expected workspace identity rejection")
	}
	if _, err := os.Lstat(filepath.Join(outside, "conversation-a.jsonl")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("outside workspace was accessed")
	}
}

func TestDifferentWorkspacesConcurrentFirstCreateDoesNotFail(t *testing.T) {
	base := t.TempDir()
	ids := []workspaceid.WorkspaceID{"ws_0123456789abcdef0123456789abcdef", "ws_fedcba9876543210fedcba9876543210"}
	var wait sync.WaitGroup
	errorsSeen := make(chan error, 2)
	for _, id := range ids {
		store, _ := NewHistoryStore(base, id)
		wait.Add(1)
		go func() { defer wait.Done(); errorsSeen <- store.SetEnabled(context.Background(), true) }()
	}
	wait.Wait()
	close(errorsSeen)
	for err := range errorsSeen {
		if err != nil {
			t.Fatalf("concurrent first create: %v", err)
		}
	}
}

func TestLocksChildReplacementBeforeOpenRootIsRejectedWithoutSplitLock(t *testing.T) {
	store := enabledTestStore(t)
	locks := filepath.Join(store.historyDir, "locks")
	moved := locks + ".moved"
	sibling := filepath.Join(store.historyDir, "outside-locks")
	if err := os.Mkdir(sibling, 0o755); err != nil {
		t.Fatalf("create sibling: %v", err)
	}
	if err := os.Chmod(sibling, 0o755); err != nil {
		t.Fatalf("chmod sibling: %v", err)
	}
	store.locksOpenHook = func() {
		if err := os.Rename(locks, moved); err != nil {
			t.Fatalf("rename locks: %v", err)
		}
		if err := os.Symlink("outside-locks", locks); err != nil {
			t.Fatalf("symlink locks: %v", err)
		}
	}
	if _, err := store.Append(context.Background(), validRecord("conversation-a", "attempt-a")); err == nil {
		t.Fatal("expected locks identity rejection")
	}
	if _, err := os.Lstat(filepath.Join(sibling, store.workspaceID+".lock")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("lock split into replacement directory")
	}
	info, _ := os.Stat(sibling)
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("replacement mode changed to %o", info.Mode().Perm())
	}
}
