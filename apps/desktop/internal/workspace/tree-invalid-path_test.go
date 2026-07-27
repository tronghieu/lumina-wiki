package workspace

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"unicode/utf8"
)

func TestTreeSkipsDistinctInvalidUTF8NamesWithoutDTOCollision(t *testing.T) {
	root := makeTreeWorkspace(t)
	builder := NewTreeBuilder()
	defaultRead := builder.readDir
	builder.readDir = func(file *os.File, path string, count int) ([]os.DirEntry, error) {
		if path == "wiki/concepts" {
			return []os.DirEntry{syntheticDirEntry{name: string([]byte{'x', 0xff})}, syntheticDirEntry{name: string([]byte{'x', 0xfe})}}, io.EOF
		}
		return defaultRead(file, path, count)
	}
	tree, err := builder.Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	concepts := findTreeNode(tree.Nodes, "wiki/concepts")
	if concepts == nil || len(concepts.Children) != 0 {
		t.Fatalf("invalid nodes: %#v", concepts)
	}
	count := 0
	for _, warning := range tree.Warnings {
		if warning.Code == "invalid_path_encoding" {
			count++
			if warning.Path != "wiki/concepts" || !utf8.ValidString(warning.Path) {
				t.Fatalf("warning=%#v", warning)
			}
		}
	}
	if count != 1 {
		t.Fatalf("warnings=%#v", tree.Warnings)
	}
	raw, err := json.Marshal(tree)
	if err != nil || !utf8.Valid(raw) {
		t.Fatalf("invalid JSON: %q, %v", raw, err)
	}
}

func TestTreeSkipsInvalidUTF8FilesystemNamesOnUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows filenames are UTF-16")
	}
	root := makeTreeWorkspace(t)
	dir := filepath.Join(root, "wiki", "concepts")
	for _, rawName := range [][]byte{{'y', 0xff}, {'y', 0xfe}} {
		if err := os.WriteFile(filepath.Join(dir, string(rawName)), nil, 0o600); err != nil {
			t.Skipf("filesystem rejects invalid UTF-8 names: %v", err)
		}
	}
	tree, err := NewTreeBuilder().Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	concepts := findTreeNode(tree.Nodes, "wiki/concepts")
	if concepts == nil || len(concepts.Children) != 1 || concepts.Children[0].Name != "note.md" {
		t.Fatalf("nodes=%#v", concepts)
	}
	count := 0
	for _, warning := range tree.Warnings {
		if warning.Code == "invalid_path_encoding" {
			count++
			if warning.Path != "wiki/concepts" {
				t.Fatalf("warning=%#v", warning)
			}
		}
	}
	if count != 1 {
		t.Fatalf("warnings=%#v", tree.Warnings)
	}
}
