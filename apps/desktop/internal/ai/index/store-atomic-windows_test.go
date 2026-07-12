//go:build windows

package index

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsWriteThroughReplacementSupportsExistingPointer(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "old"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("previous"), 0o600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := platformReplaceIndexFile(root, "old", "manifest.json"); err != nil {
		t.Fatal(err)
	}
	if err := platformSyncIndexRoot(root); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil || string(raw) != "new" {
		t.Fatalf("replacement: %q %v", raw, err)
	}
}
