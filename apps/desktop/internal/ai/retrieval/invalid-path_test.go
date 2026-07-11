package retrieval

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"unicode/utf8"
)

type invalidNameEntry struct{ name string }

func (entry invalidNameEntry) Name() string         { return entry.name }
func (invalidNameEntry) IsDir() bool                { return false }
func (invalidNameEntry) Type() fs.FileMode          { return 0 }
func (invalidNameEntry) Info() (fs.FileInfo, error) { return nil, fs.ErrNotExist }

func TestSnapshotSkipsDistinctInvalidUTF8NamesWithoutDTOCollision(t *testing.T) {
	root := workspace(t)
	corpus := NewCorpus()
	defaultRead := corpus.readDir
	corpus.readDir = func(file *os.File, path string, count int) ([]os.DirEntry, error) {
		if path == "wiki/concepts" {
			return []os.DirEntry{invalidNameEntry{name: string([]byte{'a', 0xff})}, invalidNameEntry{name: string([]byte{'a', 0xfe})}}, io.EOF
		}
		return defaultRead(file, path, count)
	}
	snapshot, err := corpus.Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Documents) != 0 || len(snapshot.Warnings) != 1 || snapshot.Warnings[0] != (Warning{Path: "wiki/concepts", Code: WarningInvalidPathEncoding}) {
		t.Fatalf("snapshot=%#v", snapshot)
	}
	for _, warning := range snapshot.Warnings {
		if !utf8.ValidString(warning.Path) || !utf8.ValidString(warning.Code) {
			t.Fatalf("invalid warning: %#v", warning)
		}
	}
	raw, err := json.Marshal(snapshot)
	if err != nil || !utf8.Valid(raw) {
		t.Fatalf("invalid JSON: %q, %v", raw, err)
	}
}

func TestSnapshotSkipsInvalidUTF8FilesystemNamesOnUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows filenames are UTF-16")
	}
	root := workspace(t)
	dir := filepath.Join(root, "wiki", "concepts")
	for _, rawName := range [][]byte{{'x', 0xff, '.', 'm', 'd'}, {'x', 0xfe, '.', 'm', 'd'}} {
		if err := os.WriteFile(filepath.Join(dir, string(rawName)), []byte("hidden"), 0o600); err != nil {
			t.Skipf("filesystem rejects invalid UTF-8 names: %v", err)
		}
	}
	snapshot, err := NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Documents) != 0 || len(snapshot.Warnings) != 1 || snapshot.Warnings[0] != (Warning{Path: "wiki/concepts", Code: WarningInvalidPathEncoding}) {
		t.Fatalf("snapshot=%#v", snapshot)
	}
}
