package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

func managementWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "wiki", "concepts"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# workspace"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "wiki", "concepts", "note.md"), []byte("body"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestLoadedRuntimeManagementDelegatesWithinLifetime(t *testing.T) {
	root := managementWorkspace(t)
	now := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)
	record := completedRecord("conversation", "attempt", "question", "answer", now)
	metadata := history.ConversationMetadata{ConversationID: "conversation", CreatedAt: now, UpdatedAt: now, Attempts: 1, LatestStatus: history.StatusCompleted}
	store := &runtimeHistorySpy{enabled: true, records: []history.ConversationRecord{record}, metadata: []history.ConversationMetadata{metadata},
		deleteResult: history.DeleteResult{Removed: true, Durable: true}, deleteAllResult: history.DeleteAllResult{DeletedIDs: []string{"conversation"}, DurableDeletedIDs: []string{"conversation"}, UncertainDeletedIDs: []string{}, RemainingIDs: []string{}, Durable: true}}
	runtime := newRuntimeForTest(t, root, &runtimeConfigSpy{}, store, &runtimeProviderSpy{})
	tree, err := runtime.WorkspaceTree(context.Background())
	if err != nil || len(tree.Nodes) != 1 || tree.Nodes[0].Path != "wiki" {
		t.Fatalf("tree=%+v err=%v", tree, err)
	}
	enabled, err := runtime.HistoryEnabled(context.Background())
	if err != nil || !enabled {
		t.Fatalf("enabled=%v err=%v", enabled, err)
	}
	if err := runtime.SetHistoryEnabled(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if enabled, _ := runtime.HistoryEnabled(context.Background()); enabled {
		t.Fatal("history still enabled")
	}
	listed, err := runtime.ListHistory(context.Background())
	if err != nil || !reflect.DeepEqual(listed, []history.ConversationMetadata{metadata}) {
		t.Fatalf("list=%+v err=%v", listed, err)
	}
	loaded, err := runtime.LoadHistory(context.Background(), "conversation")
	if err != nil || !reflect.DeepEqual(loaded, []history.ConversationRecord{record}) {
		t.Fatalf("load=%+v err=%v", loaded, err)
	}
	deleted, err := runtime.DeleteHistory(context.Background(), "conversation")
	if err != nil || deleted != store.deleteResult {
		t.Fatalf("delete=%+v err=%v", deleted, err)
	}
	all, err := runtime.DeleteAllHistory(context.Background())
	if err != nil || !reflect.DeepEqual(all, store.deleteAllResult) {
		t.Fatalf("delete all=%+v err=%v", all, err)
	}
}

func TestLoadedRuntimeManagementRejectsAfterClose(t *testing.T) {
	runtime := newRuntimeForTest(t, managementWorkspace(t), &runtimeConfigSpy{}, &runtimeHistorySpy{}, &runtimeProviderSpy{})
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.WorkspaceTree(context.Background()); err == nil {
		t.Fatal("closed runtime exposed tree")
	}
	if _, err := runtime.ListHistory(context.Background()); err == nil {
		t.Fatal("closed runtime exposed history")
	}
}

func TestLoadedRuntimeManagementPreservesExpiredDeadline(t *testing.T) {
	runtime := newRuntimeForTest(t, managementWorkspace(t), &runtimeConfigSpy{}, &runtimeHistorySpy{}, &runtimeProviderSpy{})
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if _, err := runtime.HistoryEnabled(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err=%v", err)
	}
}
