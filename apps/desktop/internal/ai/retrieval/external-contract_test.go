package retrieval_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func externalIndex(t *testing.T, content string) *retrieval.Lexical {
	t.Helper()
	index, _ := externalWorkspace(t, content)
	return index
}

func externalWorkspace(t *testing.T, content string) (*retrieval.Lexical, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "wiki", "custom"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# workspace"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "wiki", "custom", "note.md"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	index, err := retrieval.BuildLexical(context.Background(), retrieval.NewCorpus(), root)
	if err != nil {
		t.Fatal(err)
	}
	return index, root
}

func TestPersistedChunkIDHydratesToSealedCitationHit(t *testing.T) {
	index := externalIndex(t, "# Topic\n\nneedle body")
	result, err := index.Search(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	persistedID := result.Hits[0].ID
	encoded, err := json.Marshal(result.Hits[0])
	if err != nil || strings.Contains(string(encoded), "identity") || strings.Contains(string(encoded), "seal") {
		t.Fatalf("private capability serialized: %s, %v", encoded, err)
	}
	hit, err := index.ValidateChunk(context.Background(), persistedID, 0.42)
	if err != nil {
		t.Fatal(err)
	}
	reader, citations, err := retrieval.NewCitationReader(context.Background(), index, []retrieval.Hit{hit}, retrieval.CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	note, err := reader.ReadCitationNote(context.Background(), citations[0].ID)
	if err != nil || note.Path != "wiki/custom/note.md" || note.Content != "# Topic\n\nneedle body" {
		t.Fatalf("hydrated citation = %#v, %v", note, err)
	}
}

func TestHydrationRejectsUnknownForgedForeignAndStaleHits(t *testing.T) {
	index, root := externalWorkspace(t, "needle body")
	if _, err := index.ValidateChunk(context.Background(), "0000000000000000000000000000000000000000000000000000000000000000", 1); !errors.Is(err, retrieval.ErrUnknownChunk) {
		t.Fatalf("unknown = %v", err)
	}
	search, err := index.Search(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	forged := retrieval.Hit{Chunk: retrieval.Chunk{ID: search.Hits[0].ID}}
	if _, _, err := retrieval.NewCitationReader(context.Background(), index, []retrieval.Hit{forged}, retrieval.CitationOptions{}); !errors.Is(err, retrieval.ErrUnsealedHit) {
		t.Fatalf("forged = %v", err)
	}
	tampered := search.Hits[0]
	tampered.ID = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	if _, _, err := retrieval.NewCitationReader(context.Background(), index, []retrieval.Hit{tampered}, retrieval.CitationOptions{}); !errors.Is(err, retrieval.ErrUnsealedHit) {
		t.Fatalf("tampered sealed hit = %v", err)
	}
	foreign := externalIndex(t, "foreign needle")
	foreignHits, err := foreign.Search(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := retrieval.NewCitationReader(context.Background(), index, foreignHits.Hits, retrieval.CitationOptions{}); !errors.Is(err, retrieval.ErrForeignHit) {
		t.Fatalf("foreign = %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "wiki", "custom", "note.md"), []byte("changed needle"), 0o600); err != nil {
		t.Fatal(err)
	}
	stale, err := index.ValidateChunk(context.Background(), search.Hits[0].ID, 1)
	if !errors.Is(err, retrieval.ErrStaleIndex) || stale.Text != "" {
		t.Fatalf("stale = %#v, %v", stale, err)
	}
}
