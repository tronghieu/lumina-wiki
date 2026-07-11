package retrieval

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotPropagatesDirectoryContextErrors(t *testing.T) {
	for _, injected := range []error{context.Canceled, context.DeadlineExceeded} {
		t.Run(injected.Error(), func(t *testing.T) {
			root := workspace(t)
			corpus := NewCorpus()
			defaultRead := corpus.readDir
			corpus.readDir = func(file *os.File, path string, count int) ([]os.DirEntry, error) {
				if path == "wiki/concepts" {
					return nil, injected
				}
				return defaultRead(file, path, count)
			}
			_, err := corpus.Snapshot(context.Background(), root)
			if !errors.Is(err, injected) {
				t.Fatalf("context error = %v", err)
			}
		})
	}
}

func TestStablePermissionFailureWarnsWithoutRetry(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "concepts", "denied.md"), "private")
	corpus := NewCorpus()
	opens := 0
	corpus.openFile = func(root *os.Root, relative string) (*os.File, error) {
		if relative == "wiki/concepts/denied.md" {
			opens++
			return nil, os.ErrPermission
		}
		return root.Open(relative)
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if opens != 1 {
		t.Fatalf("permission failure retried %d times", opens)
	}
	if len(snapshot.Warnings) != 1 || snapshot.Warnings[0] != (Warning{Path: "wiki/concepts/denied.md", Code: WarningUnreadable}) {
		t.Fatalf("warnings = %#v", snapshot.Warnings)
	}
}

func TestRepeatedENOENTOpenRaceWarnsChangedPath(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "concepts", "gone.md"), "content")
	corpus := NewCorpus()
	opens := 0
	corpus.openFile = func(root *os.Root, relative string) (*os.File, error) {
		if relative == "wiki/concepts/gone.md" {
			opens++
			return nil, os.ErrNotExist
		}
		return root.Open(relative)
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if opens != 2 {
		t.Fatalf("race opens = %d", opens)
	}
	if len(snapshot.Documents) != 0 || len(snapshot.Warnings) != 1 || snapshot.Warnings[0] != (Warning{Path: "wiki/concepts/gone.md", Code: WarningChanged}) {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestStableReadDirFailureWarnsDirectoryUnreadable(t *testing.T) {
	root := workspace(t)
	corpus := NewCorpus()
	reads := 0
	corpus.readDir = func(file *os.File, relative string, count int) ([]os.DirEntry, error) {
		if relative == "wiki/concepts" {
			reads++
			return nil, os.ErrPermission
		}
		return file.ReadDir(count)
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if reads != 1 {
		t.Fatalf("directory failure retried %d times", reads)
	}
	if len(snapshot.Warnings) != 1 || snapshot.Warnings[0] != (Warning{Path: "wiki/concepts", Code: WarningDirectoryUnreadable}) {
		t.Fatalf("warnings = %#v", snapshot.Warnings)
	}
}

func TestRepeatedDirectoryDisappearanceWarnsChangedSubtree(t *testing.T) {
	root := workspace(t)
	corpus := NewCorpus()
	opens := 0
	corpus.openFile = func(root *os.Root, relative string) (*os.File, error) {
		if relative == "wiki/concepts" {
			opens++
			return nil, os.ErrNotExist
		}
		return root.Open(relative)
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if opens != 2 {
		t.Fatalf("directory race opens = %d", opens)
	}
	if len(snapshot.Warnings) != 1 || snapshot.Warnings[0] != (Warning{Path: "wiki/concepts", Code: WarningDirectoryChanged}) {
		t.Fatalf("warnings = %#v", snapshot.Warnings)
	}
}

func TestStableSymlinkIsSkippedWithoutRetry(t *testing.T) {
	root := workspace(t)
	out := filepath.Join(t.TempDir(), "outside.md")
	mustWrite(t, out, "outside")
	if err := os.Symlink(out, filepath.Join(root, "wiki", "concepts", "linked.md")); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "wiki", "concepts", "real.md"), "real")
	corpus := NewCorpus()
	opens := 0
	corpus.openFile = func(root *os.Root, relative string) (*os.File, error) {
		if relative == "wiki/concepts/real.md" {
			opens++
		}
		return root.Open(relative)
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if opens != FileVerificationReads || len(snapshot.Warnings) != 0 {
		t.Fatalf("opens=%d warnings=%#v", opens, snapshot.Warnings)
	}
}
