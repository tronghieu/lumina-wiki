package history

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestHistoryNeverTouchesWorkspaceTree(t *testing.T) {
	workspace := t.TempDir()
	_ = os.WriteFile(filepath.Join(workspace, "README.md"), []byte("unchanged"), 0o600)
	before := treeManifest(t, workspace)
	store := enabledTestStore(t)
	_, _ = store.Append(context.Background(), validRecord("conversation-a", "attempt-a"))
	after := treeManifest(t, workspace)
	if strings.Join(before, "\n") != strings.Join(after, "\n") {
		t.Fatalf("workspace tree changed: %v -> %v", before, after)
	}
}

func treeManifest(t *testing.T, root string) []string {
	t.Helper()
	var paths []string
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err == nil {
			rel, _ := filepath.Rel(root, path)
			paths = append(paths, rel)
		}
		return err
	})
	sort.Strings(paths)
	return paths
}
