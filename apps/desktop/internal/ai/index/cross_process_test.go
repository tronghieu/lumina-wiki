package index

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCrossProcessLockBlocksMutationsBeforeProvider(t *testing.T) {
	base := t.TempDir()
	store, _ := newTestStore(base, testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	request := requestFor(provider, buildChunk("1", "first", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	pointer, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	command := exec.Command(os.Args[0], "-test.run=TestIndexLockHelperProcess", "--", base)
	command.Env = append(os.Environ(), "LUMINA_INDEX_LOCK_HELPER=1")
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stdin.Close(); _ = command.Process.Kill(); _ = command.Wait() }()
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || line != "locked\n" {
		t.Fatalf("helper: %q %v", line, err)
	}
	provider.calls = nil
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if _, err := store.Build(ctx, request, nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("build lock: %v", err)
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel2()
	if _, err := store.Clear(ctx2); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("clear lock: %v", err)
	}
	if len(provider.calls) != 0 {
		t.Fatal("provider called before workspace lock")
	}
	after, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if string(after) != string(pointer) {
		t.Fatal("blocked mutation changed pointer")
	}
	if err := stdin.Close(); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatalf("post-release build: %v", err)
	}
}

func TestIndexLockHelperProcess(t *testing.T) {
	if os.Getenv("LUMINA_INDEX_LOCK_HELPER") != "1" {
		return
	}
	base := os.Args[len(os.Args)-1]
	store, err := newTestStore(base, testWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	root, err := store.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	release, err := store.acquireLock(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	fmt.Println("locked")
	_, _ = bufio.NewReader(os.Stdin).ReadByte()
}

func TestCacheBaseReplacementAndLockSymlinkRejected(t *testing.T) {
	base := t.TempDir()
	store, _ := newTestStore(base, testWorkspace)
	moved := base + "-moved"
	if err := os.Rename(base, moved); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(base, 0o700); err != nil {
		t.Fatal(err)
	}
	request := requestFor(&recordingEmbedder{dims: 3}, buildChunk("1", "private", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), request, nil); err == nil {
		t.Fatal("replaced cache base accepted")
	}
	store, _ = newTestStore(base, testWorkspace)
	root, err := store.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	root.Close()
	if err := os.Symlink(filepath.Join(t.TempDir(), "lock"), filepath.Join(store.workspaceDir, lockName)); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := store.Build(context.Background(), request, nil); err == nil {
		t.Fatal("symlink lock accepted")
	}
}

func TestOwnedCacheLevelReplacementRejectedForStoreLifetime(t *testing.T) {
	for _, level := range []string{"desktop", "indexes", "workspace"} {
		t.Run(level, func(t *testing.T) {
			base := t.TempDir()
			store, _ := newTestStore(base, testWorkspace)
			if _, err := store.Status(context.Background(), StatusRequest{}); err != nil {
				t.Fatal(err)
			}
			path := map[string]string{
				"desktop":   filepath.Join(base, ownedCacheLeaf),
				"indexes":   filepath.Join(base, ownedCacheLeaf, indexesLeaf),
				"workspace": store.workspaceDir,
			}[level]
			if err := os.Rename(path, path+"-moved"); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(path, 0o700); err != nil {
				t.Fatal(err)
			}
			if _, err := store.Status(context.Background(), StatusRequest{}); err == nil {
				t.Fatal("replacement accepted")
			}
		})
	}
}
