//go:build !windows

package appprivate

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestUnixStoreUsesPrivateModes(t *testing.T) {
	store := newTestStore(t, t.TempDir())
	if err := store.Write(context.Background(), []byte("private")); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]os.FileMode{
		store.appDir:    0o700,
		store.stateDir:  0o700,
		store.statePath: 0o600,
		store.lockPath:  0o600,
	} {
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != want {
			t.Fatalf("%s mode = %o, want %o", filepath.Base(path), got, want)
		}
	}
}

func TestUnixStoreRejectsPermissiveStateAndLock(t *testing.T) {
	t.Run("state", func(t *testing.T) {
		store := newTestStore(t, t.TempDir())
		if err := store.Write(context.Background(), []byte("private")); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(store.statePath, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Read(context.Background()); !errors.Is(err, ErrUnsafeState) {
			t.Fatalf("read error = %v, want ErrUnsafeState", err)
		}
	})
	t.Run("lock", func(t *testing.T) {
		store := newTestStore(t, t.TempDir())
		if err := store.Write(context.Background(), []byte("private")); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(store.lockPath, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Read(context.Background()); !errors.Is(err, ErrUnsafeState) {
			t.Fatalf("read error = %v, want ErrUnsafeState", err)
		}
	})
}

func TestStoreRejectsSymlinkedConfigBase(t *testing.T) {
	parent := t.TempDir()
	actual := filepath.Join(parent, "actual")
	if err := os.Mkdir(actual, 0o700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(parent, "link")
	if err := os.Symlink(actual, link); err != nil {
		t.Fatal(err)
	}
	store := newTestStore(t, link)
	if _, err := store.Read(context.Background()); !errors.Is(err, ErrUnsafeState) {
		t.Fatalf("read error = %v, want ErrUnsafeState", err)
	}
}
