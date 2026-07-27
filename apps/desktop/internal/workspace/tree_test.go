package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func makeTreeWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, dir := range []string{"_lumina/scripts", "raw/sources", "wiki/concepts"} {
		if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(dir)), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for path, content := range map[string]string{"README.md": "# root", "_lumina/scripts/tool.mjs": "tool", "raw/sources/input.txt": "secret raw", "wiki/concepts/note.md": "note body"} {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(path)), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestTreeReflectsRealWorkspaceMetadataOnly(t *testing.T) {
	root := makeTreeWorkspace(t)
	tree, err := NewTreeBuilder().Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if got := nodeNames(tree.Nodes); !reflect.DeepEqual(got, []string{"_lumina", "raw", "wiki"}) {
		t.Fatalf("top level = %#v", got)
	}
	var paths, ids []string
	var visit func([]TreeNode)
	visit = func(nodes []TreeNode) {
		for _, node := range nodes {
			paths = append(paths, node.Path)
			ids = append(ids, node.ID)
			if strings.Contains(strings.Join([]string{node.Name, node.Path, node.ID}, "|"), "secret raw") {
				t.Fatal("tree leaked content")
			}
			visit(node.Children)
		}
	}
	visit(tree.Nodes)
	if len(paths) != len(ids) {
		t.Fatal("missing IDs")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			t.Fatalf("invalid/colliding ID %q", id)
		}
		seen[id] = true
	}
	again, err := NewTreeBuilder().Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(tree, again) {
		t.Fatal("tree is not deterministic")
	}
}

func TestTreeMissingTopLevelHasNoPhantomNodes(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# root"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatal(err)
	}
	tree, err := NewTreeBuilder().Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if got := nodeNames(tree.Nodes); !reflect.DeepEqual(got, []string{"wiki"}) {
		t.Fatalf("nodes = %#v", got)
	}
}

func TestTreeSkipsHiddenSymlinkAndNonregular(t *testing.T) {
	root := makeTreeWorkspace(t)
	if err := os.WriteFile(filepath.Join(root, "wiki", ".hidden"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "outside.md"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "wiki", "escape")); err != nil {
		t.Fatal(err)
	}
	tree, err := NewTreeBuilder().Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	encoded := strings.Join(flatPaths(tree.Nodes), "\n")
	if strings.Contains(encoded, ".hidden") || strings.Contains(encoded, "escape") || strings.Contains(encoded, "outside") {
		t.Fatalf("unsafe entry included: %s", encoded)
	}
}

func TestTreeBoundsAndCancellation(t *testing.T) {
	root := makeTreeWorkspace(t)
	for i := 0; i < MaxTreeDirEntries*3; i++ {
		name := filepath.Join(root, "wiki", "concepts", fmt.Sprintf("entry-%04d", i))
		if err := os.WriteFile(name, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	tree, err := NewTreeBuilder().Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !tree.Truncated || len(tree.Warnings) == 0 {
		t.Fatalf("bounds not reported: %#v", tree)
	}
	var concepts *TreeNode
	var find func([]TreeNode)
	find = func(nodes []TreeNode) {
		for i := range nodes {
			if nodes[i].Path == "wiki/concepts" {
				concepts = &nodes[i]
				return
			}
			find(nodes[i].Children)
		}
	}
	find(tree.Nodes)
	if concepts == nil || len(concepts.Children) != MaxTreeDirEntries {
		t.Fatalf("retained children = %#v", concepts)
	}
	for i, child := range concepts.Children {
		if child.Name != fmt.Sprintf("entry-%04d", i) {
			t.Fatalf("child %d = %q", i, child.Name)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewTreeBuilder().Build(ctx, root); err != context.Canceled {
		t.Fatalf("cancel = %v", err)
	}
}

func nodeNames(nodes []TreeNode) []string {
	result := make([]string, len(nodes))
	for i := range nodes {
		result[i] = nodes[i].Name
	}
	return result
}
func flatPaths(nodes []TreeNode) []string {
	var result []string
	for _, node := range nodes {
		result = append(result, node.Path)
		result = append(result, flatPaths(node.Children)...)
	}
	return result
}
