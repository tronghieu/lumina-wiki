package history

import (
	"context"
	"errors"
	"os"
	"testing"
)

func TestDeleteAllReportsSecondRemoveFailureAndConverges(t *testing.T) {
	store := storeWithThreeConversations(t)
	calls := 0
	store.removeRoot = func(root *os.Root, name string) error {
		calls++
		if calls == 2 {
			return errors.New("private remove detail")
		}
		return root.Remove(name)
	}
	result, err := store.DeleteAll(context.Background())
	if err == nil || result.Durable || len(result.DeletedIDs) != 1 || len(result.RemainingIDs) != 2 {
		t.Fatalf("unexpected partial remove result: %#v %v", result, err)
	}
	store.removeRoot = func(root *os.Root, name string) error { return root.Remove(name) }
	result, err = store.DeleteAll(context.Background())
	if err != nil || !result.Durable || len(result.DeletedIDs) != 2 || len(result.RemainingIDs) != 0 {
		t.Fatalf("retry did not converge: %#v %v", result, err)
	}
}

func TestDeleteAllReportsSecondSyncFailureAndConverges(t *testing.T) {
	store := storeWithThreeConversations(t)
	calls := 0
	store.syncWorkspace = func(root *os.Root) error {
		calls++
		if calls == 2 {
			return errors.New("private sync detail")
		}
		return syncRootDirectory(root)
	}
	result, err := store.DeleteAll(context.Background())
	if err == nil || result.Durable || len(result.DurableDeletedIDs) != 1 || result.DurableDeletedIDs[0] != "conversation-a" ||
		len(result.UncertainDeletedIDs) != 1 || result.UncertainDeletedIDs[0] != "conversation-b" ||
		len(result.RemainingIDs) != 1 || result.RemainingIDs[0] != "conversation-c" {
		t.Fatalf("unexpected partial sync result: %#v %v", result, err)
	}
	store.syncWorkspace = syncRootDirectory
	result, err = store.DeleteAll(context.Background())
	if err != nil || !result.Durable || len(result.DeletedIDs) != 1 || len(result.RemainingIDs) != 0 {
		t.Fatalf("retry did not converge: %#v %v", result, err)
	}
}

func storeWithThreeConversations(t *testing.T) *HistoryStore {
	t.Helper()
	store := enabledTestStore(t)
	for _, id := range []string{"conversation-a", "conversation-b", "conversation-c"} {
		if _, err := store.Append(context.Background(), validRecord(id, "attempt-a")); err != nil {
			t.Fatalf("append %s: %v", id, err)
		}
	}
	return store
}
