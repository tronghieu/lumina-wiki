package index

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStoreRejectsSymlinkWorkspaceAndManifest(t *testing.T) {
	base := t.TempDir()
	desktop := filepath.Join(base, ownedCacheLeaf, indexesLeaf)
	if err := os.MkdirAll(desktop, 0o700); err != nil {
		t.Fatal(err)
	}
	workspace := filepath.Join(desktop, string(testWorkspace))
	if err := os.Symlink(t.TempDir(), workspace); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := newTestStore(base, testWorkspace); err == nil {
		t.Fatal("symlink workspace accepted")
	}
	if err := os.Remove(workspace); err != nil {
		t.Fatal(err)
	}
	store, err := newTestStore(base, testWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	request := requestFor(&recordingEmbedder{dims: 3}, buildChunk("1", "private", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(store.workspaceDir, manifestName)
	if err := os.Remove(manifest); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "target"), manifest); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := store.Build(context.Background(), request, nil); err == nil {
		t.Fatal("symlink manifest accepted")
	}
}

func TestKernelLockIsContextBoundedAcrossStores(t *testing.T) {
	base := t.TempDir()
	one, _ := newTestStore(base, testWorkspace)
	two, _ := newTestStore(base, testWorkspace)
	root, err := one.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	release, err := one.acquireLock(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := two.Status(ctx, StatusRequest{}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("lock wait: %v", err)
	}
}

func TestConcurrentBuildClearStatusRemainCoherent(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	request := requestFor(&recordingEmbedder{dims: 3}, buildChunk("1", "private", strings.Repeat("b", 64)))
	var wait sync.WaitGroup
	for i := 0; i < 8; i++ {
		wait.Add(1)
		go func(n int) {
			defer wait.Done()
			if n%3 == 0 {
				_, _ = store.Clear(context.Background())
				return
			}
			if n%3 == 1 {
				_, _ = store.Status(context.Background(), StatusRequest{})
				return
			}
			_, _ = store.Build(context.Background(), request, nil)
		}(i)
	}
	wait.Wait()
	status, err := store.Status(context.Background(), StatusRequest{})
	if err != nil || status.State != StateReady && status.State != StateEmpty {
		t.Fatalf("incoherent: %#v %v", status, err)
	}
}
