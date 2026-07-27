package history

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestReadWaitsForWorkspaceGateAndReturnsCoherentSnapshot(t *testing.T) {
	store := enabledTestStore(t)
	_, _ = store.Append(context.Background(), validRecord("conversation-a", "attempt-a"))
	release, _ := acquireProcessGate(context.Background(), store.key)
	done := make(chan error, 1)
	go func() {
		records, err := store.Load(context.Background(), "conversation-a")
		if err == nil && len(records) != 1 {
			err = errors.New("incoherent record count")
		}
		done <- err
	}()
	select {
	case <-done:
		t.Fatal("Load bypassed workspace gate")
	case <-time.After(20 * time.Millisecond):
	}
	release()
	if err := <-done; err != nil {
		t.Fatalf("Load after gate: %v", err)
	}
}

func TestDeleteReportsPostUnlinkDurabilityFailureAndConverges(t *testing.T) {
	store := enabledTestStore(t)
	_, _ = store.Append(context.Background(), validRecord("conversation-a", "attempt-a"))
	store.syncWorkspace = func(*os.Root) error { return errors.New("private OS detail") }
	result, err := store.Delete(context.Background(), "conversation-a")
	if err == nil || !result.Removed || result.Durable || strings.Contains(err.Error(), "private OS detail") {
		t.Fatalf("unexpected partial delete: %#v %v", result, err)
	}
	store.syncWorkspace = syncRootDirectory
	result, err = store.Delete(context.Background(), "conversation-a")
	if err != nil || result.Removed || !result.Durable {
		t.Fatalf("delete retry did not converge: %#v %v", result, err)
	}
}

func TestListRecoversBoundedOrphanTempAndRejectsTempSymlink(t *testing.T) {
	store := enabledTestStore(t)
	orphan := filepath.Join(store.workspaceDir, tempFilePrefix+"stale")
	if err := os.WriteFile(orphan, []byte("partial"), 0o600); err != nil {
		t.Fatalf("write orphan: %v", err)
	}
	if _, err := store.List(context.Background()); err != nil {
		t.Fatalf("recover orphan: %v", err)
	}
	if _, err := os.Lstat(orphan); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("orphan temp was not removed")
	}
	target := filepath.Join(t.TempDir(), "outside")
	_ = os.WriteFile(target, []byte("outside"), 0o600)
	if err := os.Symlink(target, orphan); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := store.List(context.Background()); err == nil {
		t.Fatal("expected temp symlink rejection")
	}
}

func TestProcessGateEntriesAreReclaimed(t *testing.T) {
	baseline := processGateCount()
	base := t.TempDir()
	for index := 0; index < 1000; index++ {
		id := workspaceid.WorkspaceID("ws_" + fmtWorkspaceSuffix(index))
		store, err := NewHistoryStore(base, id)
		if err != nil {
			t.Fatalf("new store %d: %v", index, err)
		}
		if err := store.SetEnabled(context.Background(), index%2 == 0); err != nil {
			t.Fatalf("set enabled %d: %v", index, err)
		}
	}
	if after := processGateCount(); after != baseline {
		t.Fatalf("gate map leaked: %d -> %d", baseline, after)
	}
}

func TestWorkspaceDirectoryReplacementCannotEscapeOpenedRoot(t *testing.T) {
	store := enabledTestStore(t)
	outside := t.TempDir()
	moved := store.workspaceDir + ".moved"
	store.workspaceHook = func() {
		if err := os.Rename(store.workspaceDir, moved); err != nil {
			t.Fatalf("rename workspace history: %v", err)
		}
		if err := os.Symlink(outside, store.workspaceDir); err != nil {
			t.Fatalf("replace with symlink: %v", err)
		}
	}
	if _, err := store.Append(context.Background(), validRecord("conversation-a", "attempt-a")); err != nil {
		t.Fatalf("append through opened root: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(outside, "conversation-a.jsonl")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("write escaped through replacement symlink")
	}
	if _, err := os.Stat(filepath.Join(moved, "conversation-a.jsonl")); err != nil {
		t.Fatalf("opened root did not remain on original directory: %v", err)
	}
}

func TestOwnedHandleProtectionFailureFailsClosedAndRedactsCause(t *testing.T) {
	store := newTestStore(t)
	store.protectHandle = func(*os.File, os.FileMode) error { return errors.New("sensitive ACL detail") }
	err := store.SetEnabled(context.Background(), true)
	if err == nil || strings.Contains(err.Error(), "sensitive ACL detail") {
		t.Fatalf("expected sanitized protection failure, got %v", err)
	}
	if _, statErr := os.Lstat(store.statePath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatal("protection failure wrote state")
	}
}

func fmtWorkspaceSuffix(index int) string {
	const hex = "0123456789abcdef"
	raw := make([]byte, 32)
	for i := range raw {
		raw[31-i] = hex[index&15]
		index >>= 4
	}
	return string(raw)
}
