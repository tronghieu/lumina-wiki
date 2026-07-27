package index

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readyStore(t *testing.T) *Store {
	t.Helper()
	store, err := newTestStore(t.TempDir(), testWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	request := requestFor(&recordingEmbedder{dims: 3}, buildChunk("1", "private", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestClearRenameFailureLeavesReadyPointerIntact(t *testing.T) {
	store := readyStore(t)
	path := filepath.Join(store.workspaceDir, manifestName)
	before, _ := os.ReadFile(path)
	original := store.rename
	store.rename = func(root *os.Root, oldName, newName string) error {
		if strings.HasPrefix(newName, ".index-tmp-clear-") {
			return errors.New("clear rename failed")
		}
		return original(root, oldName, newName)
	}
	if _, err := store.Clear(context.Background()); err == nil {
		t.Fatal("rename failure accepted")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("pointer changed before clear commit")
	}
	store.rename = original
	if status, err := store.Status(context.Background(), StatusRequest{}); err != nil || status.State != StateReady {
		t.Fatalf("status: %#v %v", status, err)
	}
}

func TestClearPostCommitFailuresAndCancellationReturnEmpty(t *testing.T) {
	for _, name := range []string{"sync", "remove", "cancel"} {
		t.Run(name, func(t *testing.T) {
			store := readyStore(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch name {
			case "sync":
				store.syncRoot = func(*os.Root) error { return errors.New("sync failed") }
			case "remove":
				store.remove = func(*os.Root, string) error { return errors.New("remove failed") }
			case "cancel":
				original := store.rename
				store.rename = func(root *os.Root, oldName, newName string) error {
					err := original(root, oldName, newName)
					if err == nil && strings.HasPrefix(newName, ".index-tmp-clear-") {
						cancel()
					}
					return err
				}
			}
			status, err := store.Clear(ctx)
			if err != nil || status.State != StateEmpty {
				t.Fatalf("clear: %#v %v", status, err)
			}
			store.syncRoot = platformSyncIndexRoot
			store.remove = func(root *os.Root, name string) error { return root.Remove(name) }
			if status, err := store.Status(context.Background(), StatusRequest{}); err != nil || status.State != StateEmpty {
				t.Fatalf("status: %#v %v", status, err)
			}
			request := requestFor(&recordingEmbedder{dims: 3}, buildChunk("2", "rebuilt", strings.Repeat("b", 64)))
			if status, err := store.Build(context.Background(), request, nil); err != nil || status.State != StateReady {
				t.Fatalf("rebuild: %#v %v", status, err)
			}
		})
	}
}
