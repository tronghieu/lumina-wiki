package retrieval

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSnapshotObservesCancellationDuringRead(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "concepts", "cancel.md"), "content")
	ctx, cancel := context.WithCancel(context.Background())
	corpus := NewCorpus()
	corpus.afterRead = func(string, int) { cancel() }
	if _, err := corpus.Snapshot(ctx, root); err != context.Canceled {
		t.Fatalf("read cancellation = %v", err)
	}
}

func TestSnapshotWarningsAreBoundedAndWorkspaceUnchanged(t *testing.T) {
	root := workspace(t)
	for index := 0; index < MaxWarnings+20; index++ {
		path := filepath.Join(root, "wiki", "concepts", "invalid-"+strings.Repeat("x", index%10)+string(rune('a'+index%26))+".md")
		if err := os.WriteFile(path, []byte{0xff}, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	before := corpusManifest(t, root)
	snapshot, err := NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Warnings) != MaxWarnings {
		t.Fatalf("warnings = %d", len(snapshot.Warnings))
	}
	if after := corpusManifest(t, root); !bytes.Equal(before, after) {
		t.Fatal("snapshot mutated workspace")
	}
}

func TestSnapshotRetriesReplacedWorkspaceRoot(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "concepts", "note.md"), "old")
	corpus := NewCorpus()
	corpus.afterRead = func(_ string, attempt int) {
		if attempt != 0 {
			return
		}
		corpus.afterRead = nil
		if err := os.Rename(root, root+"-old"); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(root, "wiki", "concepts"), 0o700); err != nil {
			t.Fatal(err)
		}
		mustWrite(t, filepath.Join(root, "README.md"), "# replacement")
		mustWrite(t, filepath.Join(root, "wiki", "concepts", "note.md"), "new")
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Documents) != 1 || snapshot.Documents[0].Content != "new" {
		t.Fatalf("stale root snapshot: %#v", snapshot.Documents)
	}
}

func TestSnapshotOmitsCorpusWhenRootChangesTwice(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "concepts", "note.md"), "zero")
	corpus := NewCorpus()
	corpus.afterRead = func(_ string, attempt int) {
		if err := os.Rename(root, fmt.Sprintf("%s-old-%d", root, attempt)); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(root, "wiki", "concepts"), 0o700); err != nil {
			t.Fatal(err)
		}
		mustWrite(t, filepath.Join(root, "README.md"), "# replacement")
		mustWrite(t, filepath.Join(root, "wiki", "concepts", "note.md"), fmt.Sprintf("replacement-%d", attempt))
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Documents) != 0 {
		t.Fatalf("second changed root included: %#v", snapshot.Documents)
	}
	if len(snapshot.Warnings) == 0 || snapshot.Warnings[0].Code != WarningChanged {
		t.Fatalf("warnings = %#v", snapshot.Warnings)
	}
}

func corpusManifest(t *testing.T, root string) []byte {
	t.Helper()
	var result []byte
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		result = append(result, []byte(rel+"|"+info.Mode().String()+"|")...)
		if info.Mode().IsRegular() {
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			result = append(result, raw...)
		}
		result = append(result, '\n')
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}
