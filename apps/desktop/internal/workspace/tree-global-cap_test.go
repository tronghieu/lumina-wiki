package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestTreeGlobalEntryCapNeverBuildsTopLevelOverflow(t *testing.T) {
	root := makeTreeWorkspace(t)
	for directory := 0; directory < 17; directory++ {
		dir := filepath.Join(root, "_lumina", fmt.Sprintf("bulk-%02d", directory))
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		for file := 0; file < MaxTreeDirEntries; file++ {
			path := filepath.Join(dir, fmt.Sprintf("entry-%04d", file))
			if err := os.WriteFile(path, nil, 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	first, err := NewTreeBuilder().Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewTreeBuilder().Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	firstIDs, secondIDs := collectTreeIDs(first.Nodes), collectTreeIDs(second.Nodes)
	if len(firstIDs) > MaxTreeEntries {
		t.Fatalf("global nodes = %d", len(firstIDs))
	}
	if !first.Truncated || !reflect.DeepEqual(firstIDs, secondIDs) {
		t.Fatalf("unstable saturated prefix: %d/%d", len(firstIDs), len(secondIDs))
	}
	if got := nodeNames(first.Nodes); !reflect.DeepEqual(got, []string{"_lumina"}) {
		t.Fatalf("top-level overflow = %#v", got)
	}
}

func collectTreeIDs(nodes []TreeNode) []string {
	result := make([]string, 0, len(nodes))
	for _, node := range nodes {
		result = append(result, node.ID)
		result = append(result, collectTreeIDs(node.Children)...)
	}
	return result
}
