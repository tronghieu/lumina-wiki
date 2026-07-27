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

func TestByteCompactionRetainsAllActiveAndOnlyFittingNewestTombstones(t *testing.T) {
	store, _ := newRegistryStore(t.TempDir())
	now := time.Now().UTC()
	registry := emptyRegistry()
	for index := 0; index < 40; index++ {
		registry.Records = append(registry.Records, largeRecord(index, true, now.Add(time.Duration(index)*time.Second)))
	}
	for index := 40; index < 72; index++ {
		registry.Records = append(registry.Records, largeRecord(index, false, now.Add(time.Duration(index)*time.Second)))
	}
	if err := store.Save(registry); err != nil {
		t.Fatalf("mixed save: %v", err)
	}
	raw, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) > MaxRegistryBytes*9/10 {
		t.Fatalf("registry exceeds safety budget: %d", len(raw))
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	active, tombstones := 0, []Record{}
	for _, record := range loaded.Records {
		if record.Active {
			active++
		} else {
			tombstones = append(tombstones, record)
		}
	}
	if active != 40 {
		t.Fatalf("active records lost: %d", active)
	}
	if len(tombstones) == 0 || len(tombstones) >= 32 {
		t.Fatalf("expected fitting subset of tombstones, got %d", len(tombstones))
	}
	for index := 1; index < len(tombstones); index++ {
		if tombstones[index].LastSeenAt.After(tombstones[index-1].LastSeenAt) {
			t.Fatal("tombstones not newest-first deterministic")
		}
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
		t.Fatalf("later attach: %v", err)
	}
}

func TestKernelLockCorrectsModeAndChmodFailureIsSafe(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix permission bits only")
	}
	base := t.TempDir()
	store, _ := newRegistryStore(base)
	if _, err := store.ensureDir(true); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.lockPath, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	release, err := store.acquireLock()
	if err != nil {
		t.Fatalf("mode correction: %v", err)
	}
	release()
	info, _ := os.Stat(store.lockPath)
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("lock mode = %o", info.Mode().Perm())
	}

	failing, _ := newRegistryStore(t.TempDir())
	failing.secureLockMode = func(*os.File) error { return errors.New("injected chmod failure") }
	if _, err := failing.acquireLock(); err == nil {
		t.Fatal("chmod failure accepted")
	}
	working, _ := newRegistryStore(filepath.Dir(failing.dir))
	release, err = working.acquireLock()
	if err != nil {
		t.Fatalf("chmod failure left unsafe handle: %v", err)
	}
	release()
}

func largeRecord(index int, active bool, seen time.Time) Record {
	suffix := fmt.Sprintf("-%03d", index)
	path := "/" + strings.Repeat(string(rune('a'+index%26)), MaxCanonicalPathBytes-len(suffix)-2) + suffix
	return Record{SchemaVersion: 1, WorkspaceID: WorkspaceID(fmt.Sprintf("ws_%032x", index+1)),
		CanonicalPath: filepath.Clean(path), FilesystemSignature: Signature(fmt.Sprintf("sig-%03d", index)),
		FirstSeenAt: seen, LastSeenAt: seen, Active: active}
}
