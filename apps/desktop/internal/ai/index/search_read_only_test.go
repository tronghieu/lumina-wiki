//go:build !windows

package index

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type cacheFileState struct {
	Name string
	Mode os.FileMode
	Size int64
	Mod  int64
	Hash [32]byte
}

func cacheState(t *testing.T, dir string) []cacheFileState {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	result := make([]cacheFileState, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		result = append(result, cacheFileState{entry.Name(), info.Mode(), info.Size(), info.ModTime().UnixNano(), sha256.Sum256(raw)})
	}
	return result
}

func TestSearchUsesValidationAndReadOnlyLockWithoutMutation(t *testing.T) {
	store, request := readySearchStore(t)
	protectCalls, validateCalls := 0, 0
	store.protect = func(*os.File, os.FileMode) error { protectCalls++; return errors.New("write protection called") }
	store.validate = func(file *os.File) error { validateCalls++; return platformValidateIndexProtectedHandle(file) }
	originalOpen := store.openLock
	store.openLock = func(root *os.Root, name string, flag int, mode os.FileMode) (*os.File, error) {
		if flag != os.O_RDONLY {
			t.Fatalf("read lock flags=%#x", flag)
		}
		return originalOpen(root, name, flag, mode)
	}
	before := cacheState(t, store.workspaceDir)
	if _, err := store.Search(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	after := cacheState(t, store.workspaceDir)
	if protectCalls != 0 || validateCalls < 3 {
		t.Fatalf("protect=%d validate=%d", protectCalls, validateCalls)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("cache mutated:\n%#v\n%#v", before, after)
	}
}

func TestSearchMissingLockIsUnavailableAndDoesNotCreate(t *testing.T) {
	store, request := readySearchStore(t)
	lock := filepath.Join(store.workspaceDir, lockName)
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Search(context.Background(), request); !errors.Is(err, ErrSemanticUnavailable) {
		t.Fatalf("error=%v", err)
	}
	if _, err := os.Lstat(lock); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("lock recreated: %v", err)
	}
}
