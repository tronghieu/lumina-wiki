package workspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTreeRejectsDirectoryReplacement(t *testing.T) {
	root := makeTreeWorkspace(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "outside.md"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	builder := NewTreeBuilder()
	builder.beforeOpen = func(path string) {
		if path != "wiki/concepts" {
			return
		}
		builder.beforeOpen = nil
		original := filepath.Join(root, "wiki", "concepts")
		if err := os.Rename(original, original+"-old"); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(outside, original); err != nil {
			t.Fatal(err)
		}
	}
	tree, err := builder.Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(flatPaths(tree.Nodes), "\n"), "outside") {
		t.Fatal("replacement escaped workspace")
	}
}

func TestTreeRejectsWorkspaceRootReplacement(t *testing.T) {
	root := makeTreeWorkspace(t)
	builder := NewTreeBuilder()
	builder.beforeOpen = func(path string) {
		if path != "_lumina" {
			return
		}
		builder.beforeOpen = nil
		if err := os.Rename(root, root+"-old"); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("replacement"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := builder.Build(context.Background(), root); err == nil {
		t.Fatal("accepted replaced workspace root")
	}
}
