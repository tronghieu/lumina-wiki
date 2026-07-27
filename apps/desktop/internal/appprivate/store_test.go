package appprivate

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const testStateLimit = 1024

func newTestStore(t *testing.T, base string) *Store {
	t.Helper()
	store, err := NewStore(base, "test-state", testStateLimit)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	return store
}

func TestStoreWriteReadRemove(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	ctx := context.Background()

	missing, err := store.Read(ctx)
	if err != nil {
		t.Fatalf("read missing state: %v", err)
	}
	if missing.Exists || missing.Data != nil {
		t.Fatalf("missing snapshot = %#v", missing)
	}

	if err := store.Write(ctx, []byte(`{"version":1}`)); err != nil {
		t.Fatalf("write state: %v", err)
	}
	loaded, err := store.Read(ctx)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	if !loaded.Exists || string(loaded.Data) != `{"version":1}` {
		t.Fatalf("loaded snapshot = %#v", loaded)
	}

	if err := store.Remove(ctx); err != nil {
		t.Fatalf("remove state: %v", err)
	}
	if err := store.Remove(ctx); err != nil {
		t.Fatalf("remove missing state: %v", err)
	}
	removed, err := store.Read(ctx)
	if err != nil {
		t.Fatalf("read removed state: %v", err)
	}
	if removed.Exists {
		t.Fatal("removed state still exists")
	}
}

func TestNewStoreRejectsInvalidConfiguration(t *testing.T) {
	base := t.TempDir()
	cases := []struct {
		name  string
		base  string
		store string
		limit int
	}{
		{name: "empty base", store: "state", limit: 1},
		{name: "relative base", base: ".", store: "state", limit: 1},
		{name: "empty name", base: base, limit: 1},
		{name: "uppercase name", base: base, store: "State", limit: 1},
		{name: "path separator", base: base, store: "one/two", limit: 1},
		{name: "dot segment", base: base, store: "..", limit: 1},
		{name: "leading hyphen", base: base, store: "-state", limit: 1},
		{name: "oversize name", base: base, store: strings.Repeat("a", maxStoreName+1), limit: 1},
		{name: "zero limit", base: base, store: "state"},
		{name: "excessive limit", base: base, store: "state", limit: MaxStateBytes + 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewStore(tc.base, tc.store, tc.limit); !errors.Is(err, ErrInvalidConfiguration) {
				t.Fatalf("NewStore error = %v, want ErrInvalidConfiguration", err)
			}
		})
	}
}

func TestStoreEnforcesWriteAndReadBounds(t *testing.T) {
	base := t.TempDir()
	store := newTestStore(t, base)
	if err := store.Write(context.Background(), nil); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("empty write error = %v, want ErrInvalidState", err)
	}
	if err := store.Write(context.Background(), make([]byte, testStateLimit+1)); !errors.Is(err, ErrStateTooLarge) {
		t.Fatalf("oversize write error = %v, want ErrStateTooLarge", err)
	}

	if err := store.Write(context.Background(), []byte("valid")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.statePath, make([]byte, testStateLimit+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Read(context.Background()); !errors.Is(err, ErrStateTooLarge) {
		t.Fatalf("oversize read error = %v, want ErrStateTooLarge", err)
	}
}

func TestStoreRejectsUnsafeStateEntries(t *testing.T) {
	tests := []struct {
		name   string
		create func(string) error
	}{
		{name: "symlink", create: func(path string) error { return os.Symlink("elsewhere", path) }},
		{name: "directory", create: func(path string) error { return os.Mkdir(path, 0o700) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestStore(t, t.TempDir())
			if err := store.Write(context.Background(), []byte("seed")); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(store.statePath); err != nil {
				t.Fatal(err)
			}
			if err := tc.create(store.statePath); err != nil {
				t.Fatal(err)
			}
			if _, err := store.Read(context.Background()); !errors.Is(err, ErrUnsafeState) {
				t.Fatalf("read error = %v, want ErrUnsafeState", err)
			}
			if err := store.Write(context.Background(), []byte("new")); !errors.Is(err, ErrUnsafeState) {
				t.Fatalf("write error = %v, want ErrUnsafeState", err)
			}
		})
	}
}

func TestAtomicCommitFailurePreservesPreviousState(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("before")); err != nil {
		t.Fatal(err)
	}
	store.renameRoot = func(*os.Root, string, string) error { return errors.New("injected rename failure") }

	if err := store.Write(context.Background(), []byte("after")); err == nil {
		t.Fatal("write succeeded despite commit failure")
	}
	raw, err := os.ReadFile(store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "before" {
		t.Fatalf("state after failed commit = %q", raw)
	}
	temps, err := filepath.Glob(filepath.Join(store.stateDir, store.tempPrefix()+"*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(temps) != 0 {
		t.Fatalf("temporary files remain after failure: %v", temps)
	}
}

func TestAtomicCommitReportsDirectorySyncFailureAfterRename(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("before")); err != nil {
		t.Fatal(err)
	}
	store.syncRoot = func(*os.Root) error { return errors.New("injected directory sync failure") }

	err := store.Write(context.Background(), []byte("after"))
	if err == nil || !strings.Contains(err.Error(), "durability") {
		t.Fatalf("write error = %v, want committed durability failure", err)
	}
	raw, readErr := os.ReadFile(store.statePath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(raw) != "after" {
		t.Fatalf("committed state after uncertain durability = %q", raw)
	}
	temps, globErr := filepath.Glob(filepath.Join(store.stateDir, store.tempPrefix()+"*"))
	if globErr != nil {
		t.Fatal(globErr)
	}
	if len(temps) != 0 {
		t.Fatalf("committed temporary file was treated as rollback residue: %v", temps)
	}
}

func TestAtomicCommitRejectsDestinationReplacement(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("before")); err != nil {
		t.Fatal(err)
	}
	store.beforeCommitHook = func() {
		store.beforeCommitHook = func() {}
		if err := os.Remove(store.statePath); err != nil {
			t.Fatalf("remove state in hook: %v", err)
		}
		if err := os.WriteFile(store.statePath, []byte("change"), 0o600); err != nil {
			t.Fatalf("replace state in hook: %v", err)
		}
	}
	if err := store.Write(context.Background(), []byte("after")); !errors.Is(err, ErrStateChanged) {
		t.Fatalf("write error = %v, want ErrStateChanged", err)
	}
	raw, err := os.ReadFile(store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "change" {
		t.Fatalf("replacement was overwritten: %q", raw)
	}
}

func TestVerifyCurrentRejectsContentMismatchWithMatchingFileIdentity(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("before")); err != nil {
		t.Fatal(err)
	}
	lease, release, err := store.acquireLease(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	info, err := lease.state.Lstat(store.stateName())
	if err != nil {
		t.Fatal(err)
	}
	version := &stateVersion{info: info, digest: sha256.Sum256([]byte("change"))}
	if err := store.verifyCurrent(lease, version); !errors.Is(err, ErrStateChanged) {
		t.Fatalf("verify error = %v, want ErrStateChanged", err)
	}
}

func TestUpdateFailurePreservesPreviousState(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("before")); err != nil {
		t.Fatal(err)
	}
	sentinel := errors.New("stop")
	if _, err := store.Update(context.Background(), func(Snapshot) (Mutation, error) {
		return Mutation{Data: []byte("after")}, sentinel
	}); !errors.Is(err, sentinel) {
		t.Fatalf("update error = %v, want sentinel", err)
	}
	loaded, err := store.Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if string(loaded.Data) != "before" {
		t.Fatalf("state after rejected update = %q", loaded.Data)
	}
}

func TestReadRejectsReplacementWhileOpening(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("before")); err != nil {
		t.Fatal(err)
	}
	store.stateOpenHook = func() {
		store.stateOpenHook = func() {}
		if err := os.Remove(store.statePath); err != nil {
			t.Fatalf("remove state in hook: %v", err)
		}
		if err := os.WriteFile(store.statePath, []byte("replacement"), 0o600); err != nil {
			t.Fatalf("replace state in hook: %v", err)
		}
	}
	if _, err := store.Read(context.Background()); !errors.Is(err, ErrStateChanged) {
		t.Fatalf("read error = %v, want ErrStateChanged", err)
	}
}

func TestStateDirectoryReplacementIsRejected(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("before")); err != nil {
		t.Fatal(err)
	}
	store.stateDirOpenHook = func() {
		store.stateDirOpenHook = func() {}
		original := store.stateDir + "-old"
		if err := os.Rename(store.stateDir, original); err != nil {
			t.Fatalf("rename state directory in hook: %v", err)
		}
		if err := os.Mkdir(store.stateDir, 0o700); err != nil {
			t.Fatalf("replace state directory in hook: %v", err)
		}
	}
	if _, err := store.Read(context.Background()); !errors.Is(err, ErrStateChanged) {
		t.Fatalf("read error = %v, want ErrStateChanged", err)
	}
}

func TestStoreLockSerializesAndHonorsContext(t *testing.T) {
	base := t.TempDir()
	first := newTestStore(t, base)
	second := newTestStore(t, base)
	release, err := first.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if _, err := second.Read(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked read error = %v, want deadline exceeded", err)
	}
	if info, err := os.Lstat(first.lockPath); err != nil {
		t.Fatalf("persistent lock missing: %v", err)
	} else if !info.Mode().IsRegular() || info.Mode()&fs.ModeSymlink != 0 {
		t.Fatalf("lock mode = %v", info.Mode())
	}
}

func TestStoreLockCoordinatesProcesses(t *testing.T) {
	base := t.TempDir()
	ready := filepath.Join(base, "ready")
	stop := filepath.Join(base, "stop")
	command := exec.Command(os.Args[0], "-test.run=^TestStoreLockHelperProcess$")
	command.Env = append(os.Environ(),
		"APPPRIVATE_LOCK_HELPER=1",
		"APPPRIVATE_LOCK_BASE="+base,
		"APPPRIVATE_LOCK_READY="+ready,
		"APPPRIVATE_LOCK_STOP="+stop,
	)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = os.WriteFile(stop, []byte("stop"), 0o600)
		_ = command.Wait()
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("helper did not acquire lock")
		}
		time.Sleep(5 * time.Millisecond)
	}
	store := newTestStore(t, base)
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Millisecond)
	defer cancel()
	if _, err := store.Read(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cross-process read error = %v, want deadline exceeded", err)
	}
}

func TestStoreLockHelperProcess(t *testing.T) {
	if os.Getenv("APPPRIVATE_LOCK_HELPER") != "1" {
		return
	}
	store, err := NewStore(os.Getenv("APPPRIVATE_LOCK_BASE"), "test-state", testStateLimit)
	if err != nil {
		t.Fatal(err)
	}
	release, err := store.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if err := os.WriteFile(os.Getenv("APPPRIVATE_LOCK_READY"), []byte("ready"), 0o600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(os.Getenv("APPPRIVATE_LOCK_STOP")); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("helper release timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestConcurrentUpdatesDoNotLoseWrites(t *testing.T) {
	base := t.TempDir()
	first := newTestStore(t, base)
	second := newTestStore(t, base)
	if err := first.Write(context.Background(), []byte("0")); err != nil {
		t.Fatal(err)
	}

	const updates = 40
	var wg sync.WaitGroup
	errs := make(chan error, updates)
	for i := 0; i < updates; i++ {
		wg.Add(1)
		store := first
		if i%2 == 1 {
			store = second
		}
		go func() {
			defer wg.Done()
			_, err := store.Update(context.Background(), func(snapshot Snapshot) (Mutation, error) {
				value, err := strconv.Atoi(string(snapshot.Data))
				if err != nil {
					return Mutation{}, err
				}
				return Mutation{Data: []byte(strconv.Itoa(value + 1))}, nil
			})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent update: %v", err)
		}
	}
	loaded, err := first.Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if string(loaded.Data) != fmt.Sprint(updates) {
		t.Fatalf("final state = %q, want %d", loaded.Data, updates)
	}
}

func TestStoreRejectsStaleUnsafeTemporaryEntry(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("seed")); err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(store.stateDir, store.tempPrefix()+"stale")
	if err := os.Symlink("elsewhere", stale); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(context.Background(), []byte("next")); !errors.Is(err, ErrUnsafeState) {
		t.Fatalf("write error = %v, want ErrUnsafeState", err)
	}
}

func TestStoreCleansBoundedStaleTemporaryEntryBeforeWrite(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("seed")); err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(store.stateDir, store.tempPrefix()+"stale")
	file, err := os.OpenFile(stale, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if err := platformProtectHandle(file, 0o600); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("incomplete")); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(context.Background(), []byte("next")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(stale); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("stale temporary file remains: %v", err)
	}
}
