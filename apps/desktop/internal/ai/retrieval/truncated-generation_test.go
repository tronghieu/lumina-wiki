package retrieval

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestTruncatedCurrentGenerationRejectsAllEvidenceOperations(t *testing.T) {
	index, root := buildSearch(t, map[string]string{"wiki/a-target.md": "needle"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	reader, citations, err := NewCitationReader(context.Background(), index, search.Hits, CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	overflow := filepath.Join(root, "wiki", "z-overflow")
	if err := os.MkdirAll(overflow, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i <= MaxDirectoryEntries; i++ {
		if err := os.WriteFile(filepath.Join(overflow, fmt.Sprintf("entry-%05d.txt", i)), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Truncated || snapshot.SnapshotHash != index.snapshotHash {
		t.Fatalf("fixture = %#v", snapshot)
	}
	result, err := index.Search(context.Background(), "needle", SearchOptions{})
	if !errors.Is(err, ErrStaleIndex) || len(result.Hits) != 0 {
		t.Fatalf("search = %#v, %v", result, err)
	}
	if hit, err := index.ValidateChunk(context.Background(), search.Hits[0].ID, 1); !errors.Is(err, ErrStaleIndex) || hit.Text != "" {
		t.Fatalf("hydrate = %#v, %v", hit, err)
	}
	if created, ids, err := NewCitationReader(context.Background(), index, search.Hits, CitationOptions{}); !errors.Is(err, ErrStaleIndex) || created != nil || ids != nil {
		t.Fatalf("construct = %v %#v %v", created, ids, err)
	}
	if note, err := reader.ReadCitationNote(context.Background(), citations[0].ID); !errors.Is(err, ErrStaleIndex) || note.Content != "" {
		t.Fatalf("read = %#v, %v", note, err)
	}
}
