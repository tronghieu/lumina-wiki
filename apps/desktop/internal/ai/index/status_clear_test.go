package index

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestStatusReadyStaleCorruptAndClearIsolation(t *testing.T) {
	base := t.TempDir()
	store, _ := newTestStore(base, testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	request := requestFor(provider, buildChunk("1", "private", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	ready, err := store.Status(context.Background(), StatusRequest{SnapshotHash: request.SnapshotHash,
		ChunkerVersion: request.ChunkerVersion, ProfileFingerprint: request.ProfileFingerprint, Dimensions: 3})
	if err != nil || ready.State != StateReady || ready.Chunks != 1 {
		t.Fatalf("ready: %#v %v", ready, err)
	}
	stale, err := store.Status(context.Background(), StatusRequest{SnapshotHash: strings.Repeat("c", 64)})
	if err != nil || stale.State != StateStale {
		t.Fatalf("stale: %#v %v", stale, err)
	}
	otherID := workspaceid.WorkspaceID("ws_fedcba9876543210fedcba9876543210")
	other, _ := newTestStore(base, otherID)
	otherRequest := request
	otherRequest.WorkspaceID = otherID
	if _, err := other.Build(context.Background(), otherRequest, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status, _ := store.Status(context.Background(), StatusRequest{}); status.State != StateEmpty {
		t.Fatalf("clear: %#v", status)
	}
	if status, _ := other.Status(context.Background(), StatusRequest{}); status.State != StateReady {
		t.Fatalf("other cleared: %#v", status)
	}
	if err := os.WriteFile(filepath.Join(other.workspaceDir, manifestName), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if status, err := other.Status(context.Background(), StatusRequest{}); err != nil || status.State != StateCorrupt {
		t.Fatalf("corrupt: %#v %v", status, err)
	}
}

func TestManifestRenameIsCommitPoint(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	first := requestFor(provider, buildChunk("1", "first", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), first, nil); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	calls := 0
	store.syncRoot = func(root *os.Root) error {
		calls++
		if calls == 2 {
			return errors.New("final directory sync failed")
		}
		return platformSyncIndexRoot(root)
	}
	second := requestFor(provider, buildChunk("2", "second", strings.Repeat("b", 64)))
	status, err := store.Build(context.Background(), second, nil)
	if err != nil || status.State != StateReady {
		t.Fatalf("committed result reported failed: %#v %v", status, err)
	}
	after, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if string(after) == string(before) {
		t.Fatal("new pointer was not committed")
	}
}

func TestManifestRenameFailurePreservesPointerAndOrdering(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	first := requestFor(provider, buildChunk("1", "first", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), first, nil); err != nil {
		t.Fatal(err)
	}
	pointer, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	original := store.rename
	var targets []string
	store.rename = func(root *os.Root, oldName, newName string) error {
		targets = append(targets, newName)
		if newName == manifestName {
			return errors.New("pointer rename failed")
		}
		return original(root, oldName, newName)
	}
	second := requestFor(provider, buildChunk("2", "second", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), second, nil); err == nil {
		t.Fatal("manifest failure accepted")
	}
	after, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if string(after) != string(pointer) {
		t.Fatal("failed pointer rename changed pointer")
	}
	if len(targets) != 3 || !strings.HasPrefix(targets[0], "chunks.") || !strings.HasPrefix(targets[1], "vectors.") || targets[2] != manifestName {
		t.Fatalf("commit ordering: %#v", targets)
	}
}

func TestCancellationAfterManifestRenameReportsCommittedSuccess(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	first := requestFor(provider, buildChunk("1", "first", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), first, nil); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	original := store.rename
	store.rename = func(root *os.Root, oldName, newName string) error {
		err := original(root, oldName, newName)
		if err == nil && newName == manifestName {
			cancel()
		}
		return err
	}
	second := requestFor(provider, buildChunk("2", "second", strings.Repeat("b", 64)))
	status, err := store.Build(ctx, second, nil)
	if err != nil || status.State != StateReady {
		t.Fatalf("committed cancellation: %#v %v", status, err)
	}
	loaded, err := store.Status(context.Background(), StatusRequest{})
	if err != nil || loaded.State != StateReady {
		t.Fatalf("committed pointer invalid: %#v %v", loaded, err)
	}
}
