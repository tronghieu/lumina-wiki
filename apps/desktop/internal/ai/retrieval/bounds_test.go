package retrieval

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSnapshotFailsSafeOnThousandsOfDirectoryEntries(t *testing.T) {
	root := workspace(t)
	for index := 0; index < MaxDirectoryEntries+1; index++ {
		path := filepath.Join(root, "wiki", "concepts", fmt.Sprintf("note-%05d.md", index))
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Truncated || len(snapshot.Documents) != 0 {
		t.Fatalf("unsafe overflow result: %#v", snapshot)
	}
}

func TestSnapshotRejectsOverlongRelativePathBeforeFilesystemAccess(t *testing.T) {
	rootPath := workspace(t)
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if _, err := lstatReal(root, strings.Repeat("a", MaxRelativePathBytes+1)); err == nil {
		t.Fatal("accepted overlong path")
	}
}
