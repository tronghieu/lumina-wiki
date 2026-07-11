package workspaceid

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestKernelLockPersistsAndSerializesIndependentStores(t *testing.T) {
	base := t.TempDir()
	one, _ := newRegistryStore(base)
	two, _ := newRegistryStore(base)
	releaseOne, err := one.acquireLock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(one.lockPath); err != nil {
		t.Fatalf("persistent lock missing: %v", err)
	}
	if _, err := two.acquireLock(); !errors.Is(err, ErrRegistryBusy) {
		t.Fatalf("second lock = %v", err)
	}
	releaseOne()
	releaseTwo, err := two.acquireLock()
	if err != nil {
		t.Fatal(err)
	}
	releaseOne() // stale/idempotent release cannot unlock another handle.
	third, _ := newRegistryStore(base)
	if _, err := third.acquireLock(); !errors.Is(err, ErrRegistryBusy) {
		t.Fatalf("stale release affected owner: %v", err)
	}
	releaseTwo()
	if _, err := os.Stat(one.lockPath); err != nil {
		t.Fatalf("release removed persistent lock: %v", err)
	}
}

func TestKernelLockRejectsSymlinkAndNonRegularPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation may require privileges")
	}
	store, _ := newRegistryStore(t.TempDir())
	if _, err := store.ensureDir(true); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(target, []byte("unchanged"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, store.lockPath); err != nil {
		t.Fatal(err)
	}
	if _, err := store.acquireLock(); err == nil {
		t.Fatal("symlink lock accepted")
	}
	raw, _ := os.ReadFile(target)
	if string(raw) != "unchanged" {
		t.Fatal("symlink target changed")
	}
	if err := os.Remove(store.lockPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(store.lockPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := store.acquireLock(); err == nil {
		t.Fatal("directory lock accepted")
	}
}

func TestRegistrySaveCompactsForByteBudgetBeforeCountLimit(t *testing.T) {
	store, _ := newRegistryStore(t.TempDir())
	now := time.Now().UTC()
	registry := emptyRegistry()
	for index := 0; index < 120; index++ {
		path := "/" + strings.Repeat(string(rune('a'+index%26)), MaxCanonicalPathBytes-20) + strings.Repeat("x", index%17)
		path = filepath.Clean(path)
		registry.Records = append(registry.Records, Record{SchemaVersion: 1,
			WorkspaceID:   WorkspaceID("ws_" + strings.Repeat(string("0123456789abcdef"[index%16]), 32)),
			CanonicalPath: path, FilesystemSignature: Signature("sig-" + strings.Repeat("x", index)),
			FirstSeenAt: now.Add(time.Duration(index) * time.Second), LastSeenAt: now.Add(time.Duration(index) * time.Second)})
	}
	// IDs must be unique for a valid pre-compaction registry.
	for index := range registry.Records {
		registry.Records[index].WorkspaceID = WorkspaceID("ws_" + leftPaddedHex(index))
	}
	if err := store.Save(registry); err != nil {
		t.Fatalf("byte-budget save: %v", err)
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) > MaxRegistryBytes {
		t.Fatalf("registry bytes = %d", len(raw))
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Records) >= 120 || len(loaded.Records) > MaxRegistryRecords {
		t.Fatalf("tombstones were not byte-compacted: %d", len(loaded.Records))
	}
	manager, err := NewManager(filepath.Dir(store.dir), Options{})
	if err != nil {
		t.Fatal(err)
	}
	root := makeWorkspace(t)
	decision, err := manager.BeginAttach(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.ConfirmAttach(decision.Token); err != nil {
		t.Fatalf("attach after compaction: %v", err)
	}
}

func leftPaddedHex(value int) string { return fmt.Sprintf("%032x", value) }
