package retrieval

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotReopensAndVerifiesEveryAcceptedFile(t *testing.T) {
	root := workspace(t)
	path := filepath.Join(root, "wiki", "concepts", "stable.md")
	mustWrite(t, path, "stable")
	corpus := NewCorpus()
	defaultOpen := corpus.openFile
	opens := 0
	corpus.openFile = func(root *os.Root, relative string) (*os.File, error) {
		if relative == "wiki/concepts/stable.md" {
			opens++
		}
		return defaultOpen(root, relative)
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Documents) != 1 || opens != FileVerificationReads {
		t.Fatalf("documents=%d opens=%d", len(snapshot.Documents), opens)
	}
	if MaxFileSnapshotReadBytes != (MaxFileBytes+1)*FileVerificationReads ||
		MaxSnapshotReadBytes != MaxCorpusSnapshotReadBytes*MaxSnapshotAttempts {
		t.Fatal("verification I/O bounds drifted")
	}
}

func TestSnapshotRetriesSameSizeMutationWithRestoredModTime(t *testing.T) {
	root := workspace(t)
	path := filepath.Join(root, "wiki", "concepts", "race.md")
	mustWrite(t, path, "aaaa")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	corpus := NewCorpus()
	corpus.afterRead = func(_ string, attempt int) {
		if attempt != 0 {
			return
		}
		if err := os.WriteFile(path, []byte("bbbb"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Documents) != 1 || snapshot.Documents[0].Content != "bbbb" {
		t.Fatalf("mixed/stale snapshot: %#v", snapshot.Documents)
	}
}

func TestSnapshotOmitsRepeatedSameSizeMutationWithRestoredModTime(t *testing.T) {
	root := workspace(t)
	path := filepath.Join(root, "wiki", "concepts", "race.md")
	mustWrite(t, path, "aaaa")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	corpus := NewCorpus()
	corpus.afterRead = func(_ string, attempt int) {
		value := "bbbb"
		if attempt == 1 {
			value = "aaaa"
		}
		if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Documents) != 0 || len(snapshot.Warnings) != 1 || snapshot.Warnings[0] != (Warning{Path: "wiki/concepts/race.md", Code: WarningChanged}) {
		t.Fatalf("snapshot=%#v", snapshot)
	}
}
