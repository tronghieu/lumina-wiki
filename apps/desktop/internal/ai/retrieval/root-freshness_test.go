package retrieval

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLexicalRejectsReplacementWorkspaceRoot(t *testing.T) {
	index, root := buildSearch(t, map[string]string{"wiki/note.md": "same needle bytes"})
	oldRoot := root + "-old"
	if err := os.Rename(root, oldRoot); err != nil {
		t.Fatal(err)
	}
	mustMkdir(t, filepath.Join(root, "wiki"))
	mustWrite(t, filepath.Join(root, "README.md"), "# replacement")
	mustWrite(t, filepath.Join(root, "wiki", "note.md"), "same needle bytes")
	result, err := index.Search(context.Background(), "needle", SearchOptions{})
	if !errors.Is(err, ErrStaleIndex) || len(result.Hits) != 0 {
		t.Fatalf("replacement root accepted: %#v, %v", result, err)
	}
}

func TestSearchAndCitationRejectReplacementRootWithOriginalNoteHardlink(t *testing.T) {
	index, root := buildSearch(t, map[string]string{"wiki/note.md": "same needle bytes"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	reader, citations, err := NewCitationReader(context.Background(), index, search.Hits, CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	oldRoot := root + "-old"
	if err := os.Rename(root, oldRoot); err != nil {
		t.Fatal(err)
	}
	mustMkdir(t, filepath.Join(root, "wiki"))
	mustWrite(t, filepath.Join(root, "README.md"), "# replacement")
	if err := os.Link(filepath.Join(oldRoot, "wiki", "note.md"), filepath.Join(root, "wiki", "note.md")); err != nil {
		t.Skipf("hardlinks unavailable: %v", err)
	}
	result, err := index.Search(context.Background(), "needle", SearchOptions{})
	if !errors.Is(err, ErrStaleIndex) || len(result.Hits) != 0 {
		t.Fatalf("hardlinked replacement root accepted: %#v, %v", result, err)
	}
	if _, err := reader.ReadCitationNote(context.Background(), citations[0].ID); !errors.Is(err, ErrStaleIndex) {
		t.Fatalf("citation accepted replacement root: %v", err)
	}
}
