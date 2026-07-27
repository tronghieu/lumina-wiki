package history

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestEnabledLifecycleRetainsHistory(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	enabled, err := store.Enabled(ctx)
	if err != nil || enabled {
		t.Fatalf("history should default disabled: enabled=%v err=%v", enabled, err)
	}
	if outcome, err := store.Append(ctx, validRecord("conversation-a", "attempt-a")); err != nil || outcome != AppendDisabled {
		t.Fatalf("disabled append outcome=%q err=%v", outcome, err)
	}
	if err := store.SetEnabled(ctx, true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if outcome, err := store.Append(ctx, validRecord("conversation-a", "attempt-a")); err != nil || outcome != AppendStored {
		t.Fatalf("append outcome=%q err=%v", outcome, err)
	}
	if err := store.SetEnabled(ctx, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if attempts, err := store.Load(ctx, "conversation-a"); err != nil || len(attempts) != 1 {
		t.Fatalf("disabled history must remain readable: %#v %v", attempts, err)
	}
	if err := store.SetEnabled(ctx, true); err != nil {
		t.Fatalf("re-enable: %v", err)
	}
	retry := validRecord("conversation-a", "attempt-b")
	retry.RetryOfAttemptID, retry.UserMessage = "attempt-a", ""
	if outcome, err := store.Append(ctx, retry); err != nil || outcome != AppendStored {
		t.Fatalf("retry append outcome=%q err=%v", outcome, err)
	}
}

func TestRetryIntegrityAndAttemptIdempotence(t *testing.T) {
	store := enabledTestStore(t)
	ctx := context.Background()
	original := validRecord("conversation-a", "attempt-a")
	if _, err := store.Append(ctx, original); err != nil {
		t.Fatalf("append original: %v", err)
	}
	if outcome, err := store.Append(ctx, original); err != nil || outcome != AppendIdempotent {
		t.Fatalf("idempotent append outcome=%q err=%v", outcome, err)
	}
	conflict := original
	conflict.AssistantOutput = "different"
	if _, err := store.Append(ctx, conflict); !errors.Is(err, ErrAttemptConflict) {
		t.Fatalf("expected attempt conflict, got %v", err)
	}
	dangling := validRecord("conversation-a", "attempt-b")
	dangling.RetryOfAttemptID, dangling.UserMessage = "missing", ""
	if _, err := store.Append(ctx, dangling); err == nil {
		t.Fatal("expected dangling retry rejection")
	}
	cross := validRecord("conversation-b", "attempt-c")
	cross.RetryOfAttemptID, cross.UserMessage = "attempt-a", ""
	if _, err := store.Append(ctx, cross); err == nil {
		t.Fatal("expected cross-conversation retry rejection")
	}
}

func TestListLoadOrderingAndDelete(t *testing.T) {
	store := enabledTestStore(t)
	ctx := context.Background()
	later := validRecord("conversation-b", "attempt-b")
	later.CreatedAt = later.CreatedAt.Add(timeMinute)
	later.FinishedAt = later.FinishedAt.Add(timeMinute)
	for _, record := range []ConversationRecord{later, validRecord("conversation-a", "attempt-a")} {
		if _, err := store.Append(ctx, record); err != nil {
			t.Fatalf("append: %v", err)
		}
	}
	metadata, err := store.List(ctx)
	if err != nil || len(metadata) != 2 || metadata[0].ConversationID != "conversation-a" {
		t.Fatalf("unexpected list: %#v %v", metadata, err)
	}
	if _, err := store.Delete(ctx, "conversation-a"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := store.Delete(ctx, "conversation-a"); err != nil {
		t.Fatalf("idempotent delete: %v", err)
	}
	if _, err := store.DeleteAll(ctx); err != nil {
		t.Fatalf("delete all: %v", err)
	}
	metadata, _ = store.List(ctx)
	if len(metadata) != 0 {
		t.Fatalf("expected empty history: %#v", metadata)
	}
}

func TestPermissionsSymlinksBoundsAndStrictJSON(t *testing.T) {
	store := enabledTestStore(t)
	ctx := context.Background()
	if _, err := store.Append(ctx, validRecord("conversation-a", "attempt-a")); err != nil {
		t.Fatalf("append: %v", err)
	}
	path := store.conversationPath("conversation-a")
	if runtime.GOOS != "windows" {
		dirInfo, _ := os.Stat(store.workspaceDir)
		fileInfo, _ := os.Stat(path)
		if dirInfo.Mode().Perm() != 0o700 || fileInfo.Mode().Perm() != 0o600 {
			t.Fatalf("unexpected modes: %o %o", dirInfo.Mode().Perm(), fileInfo.Mode().Perm())
		}
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":99}`+"\n"), 0o600); err != nil {
		t.Fatalf("corrupt fixture: %v", err)
	}
	if _, err := store.Load(ctx, "conversation-a"); err == nil || strings.Contains(err.Error(), store.workspaceDir) {
		t.Fatalf("expected safe unknown-version error, got %v", err)
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", MaxConversationFileBytes+1)), 0o600); err != nil {
		t.Fatalf("oversize fixture: %v", err)
	}
	if _, err := store.Load(ctx, "conversation-a"); err == nil {
		t.Fatal("expected oversized file rejection")
	}
	target := filepath.Join(t.TempDir(), "target")
	_ = os.WriteFile(target, []byte("outside"), 0o600)
	_ = os.Remove(path)
	if err := os.Symlink(target, path); err == nil {
		if _, err := store.Load(ctx, "conversation-a"); err == nil {
			t.Fatal("expected conversation symlink rejection")
		}
	}
}

func TestLoadRepairsPermissiveDirectoryAndRejectsPermissiveFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission check")
	}
	store := enabledTestStore(t)
	ctx := context.Background()
	if _, err := store.Append(ctx, validRecord("conversation-a", "attempt-a")); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := os.Chmod(store.workspaceDir, 0o755); err != nil {
		t.Fatalf("chmod directory: %v", err)
	}
	if _, err := store.Load(ctx, "conversation-a"); err != nil {
		t.Fatalf("expected directory permissions to be repaired: %v", err)
	}
	dirInfo, _ := os.Stat(store.workspaceDir)
	if dirInfo.Mode().Perm() != 0o700 {
		t.Fatalf("expected repaired mode 0700, got %o", dirInfo.Mode().Perm())
	}
	path := store.conversationPath("conversation-a")
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatalf("chmod file: %v", err)
	}
	if _, err := store.Load(ctx, "conversation-a"); err == nil {
		t.Fatal("expected permissive file rejection")
	}
}

const timeMinute = 60 * 1e9

func newTestStore(t *testing.T) *HistoryStore {
	t.Helper()
	store, err := NewHistoryStore(t.TempDir(), workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("NewHistoryStore: %v", err)
	}
	return store
}

func enabledTestStore(t *testing.T) *HistoryStore {
	t.Helper()
	store := newTestStore(t)
	if err := store.SetEnabled(context.Background(), true); err != nil {
		t.Fatalf("enable history: %v", err)
	}
	return store
}
