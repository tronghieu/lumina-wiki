package retrieval

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func workspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "wiki", "concepts"))
	mustWrite(t, filepath.Join(root, "README.md"), "# workspace")
	return root
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatal(err)
	}
}

func mustWrite(t *testing.T, path, value string) {
	t.Helper()
	mustMkdir(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestSnapshotPolicyAndDeterminism(t *testing.T) {
	root := workspace(t)
	for path, content := range map[string]string{
		"wiki/concepts/b.md": "bravo", "wiki/concepts/a.md": "alpha",
		"wiki/outputs/result.md": "answer", "wiki/index.md": "index",
		"wiki/log.md": "log", "wiki/graph/note.md": "graph",
		"wiki/outputs/index.md": "nested index", "wiki/concepts/log.md": "nested log",
		"wiki/.hidden/no.md": "hidden", "wiki/concepts/not.MD": "upper",
		"raw/source.md": "raw", "_lumina/private.md": "managed",
	} {
		mustWrite(t, filepath.Join(root, filepath.FromSlash(path)), content)
	}

	first, err := NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"wiki/concepts/a.md", "wiki/concepts/b.md", "wiki/concepts/log.md", "wiki/outputs/index.md", "wiki/outputs/result.md"}
	got := make([]string, len(first.Documents))
	for i, document := range first.Documents {
		got[i] = document.Path
		if !utf8.ValidString(document.Content) || document.ContentHash == "" {
			t.Fatalf("bad document: %#v", document)
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("paths = %#v", got)
	}
	if first.SnapshotHash == "" || first.SnapshotHash != second.SnapshotHash {
		t.Fatalf("hashes differ: %q %q", first.SnapshotHash, second.SnapshotHash)
	}
}

func TestReservedRootNamesAreCaseSensitive(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "Index.md"), "case-sensitive index")
	mustWrite(t, filepath.Join(root, "wiki", "LOG.md"), "case-sensitive log")
	snapshot, err := NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, document := range snapshot.Documents {
		got = append(got, document.Path)
	}
	want := []string{"wiki/Index.md", "wiki/LOG.md"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("paths = %#v", got)
	}
}

func TestSnapshotSkipsUnsafeAndInvalidFiles(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "concepts", "ok.md"), "ok")
	if err := os.WriteFile(filepath.Join(root, "wiki", "concepts", "bad.md"), []byte{0xff}, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "wiki", "concepts", "large.md"), make([]byte, MaxFileBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	mustWrite(t, outside, "secret")
	if err := os.Symlink(outside, filepath.Join(root, "wiki", "concepts", "link.md")); err != nil {
		t.Fatal(err)
	}

	snapshot, err := NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Documents) != 1 || snapshot.Documents[0].Path != "wiki/concepts/ok.md" {
		t.Fatalf("documents = %#v", snapshot.Documents)
	}
	for _, warning := range snapshot.Warnings {
		if strings.Contains(warning.Path, root) || strings.Contains(warning.Code, root) || strings.Contains(warning.Code, "secret") {
			t.Fatalf("warning leaks detail: %#v", warning)
		}
	}
}

func TestSnapshotRetriesOneChangedReadThenOmitsSecondChange(t *testing.T) {
	root := workspace(t)
	path := filepath.Join(root, "wiki", "concepts", "race.md")
	mustWrite(t, path, "one")
	corpus := NewCorpus()
	changes := 0
	corpus.afterRead = func(relative string, attempt int) {
		if relative == "wiki/concepts/race.md" && changes < 2 {
			changes++
			mustWrite(t, path, strings.Repeat("x", changes+3))
		}
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if changes != 2 {
		t.Fatalf("changes = %d", changes)
	}
	if len(snapshot.Documents) != 0 {
		t.Fatalf("raced document included: %#v", snapshot.Documents)
	}
	if len(snapshot.Warnings) != 1 || snapshot.Warnings[0] != (Warning{Path: "wiki/concepts/race.md", Code: WarningChanged}) {
		t.Fatalf("warnings = %#v", snapshot.Warnings)
	}
}

func TestSnapshotCancellationAndInvalidRoot(t *testing.T) {
	root := workspace(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewCorpus().Snapshot(ctx, root); err != context.Canceled {
		t.Fatalf("cancel = %v", err)
	}
	if _, err := NewCorpus().Snapshot(context.Background(), filepath.Join(root, "wiki")); err == nil {
		t.Fatal("accepted non-workspace root")
	}
	if _, err := NewCorpus().Snapshot(context.Background(), "relative"); err == nil {
		t.Fatal("accepted relative root")
	}
}
