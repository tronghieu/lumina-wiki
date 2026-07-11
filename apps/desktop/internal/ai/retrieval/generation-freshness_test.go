package retrieval

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestGenerationChangeStalesSearchHydrationAndCitation(t *testing.T) {
	for _, mutation := range []string{"add", "delete", "change"} {
		t.Run(mutation, func(t *testing.T) {
			index, root := buildSearch(t, map[string]string{
				"wiki/target.md":    "needle target",
				"wiki/unrelated.md": "unrelated original",
			})
			search, err := index.Search(context.Background(), "needle", SearchOptions{})
			if err != nil {
				t.Fatal(err)
			}
			chunkID := search.Hits[0].ID
			reader, citations, err := NewCitationReader(context.Background(), index, search.Hits, CitationOptions{})
			if err != nil {
				t.Fatal(err)
			}
			switch mutation {
			case "add":
				mustWrite(t, filepath.Join(root, "wiki", "added.md"), "new unrelated")
			case "delete":
				if err := os.Remove(filepath.Join(root, "wiki", "unrelated.md")); err != nil {
					t.Fatal(err)
				}
			case "change":
				mustWrite(t, filepath.Join(root, "wiki", "unrelated.md"), "unrelated changed")
			}
			staleSearch, err := index.Search(context.Background(), "needle", SearchOptions{})
			if !errors.Is(err, ErrStaleIndex) || len(staleSearch.Hits) != 0 {
				t.Fatalf("search generation accepted: %#v, %v", staleSearch, err)
			}
			staleHit, err := index.ValidateChunk(context.Background(), chunkID, 1)
			if !errors.Is(err, ErrStaleIndex) || staleHit.Text != "" {
				t.Fatalf("hydrate = %#v, %v", staleHit, err)
			}
			if _, err := reader.ReadCitationNote(context.Background(), citations[0].ID); !errors.Is(err, ErrStaleIndex) {
				t.Fatalf("citation = %v", err)
			}
		})
	}
}

func TestGenerationFreshnessCancellationStillPropagates(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/target.md": "needle"})
	result, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := index.ValidateChunk(ctx, result.Hits[0].ID, 1); err != context.Canceled {
		t.Fatalf("cancel = %v", err)
	}
}

func TestGenerationValidationPrecedesEmptyAndUnmatchedSearch(t *testing.T) {
	for _, query := range []string{"", "!!!", "missing-term"} {
		t.Run(query, func(t *testing.T) {
			index, root := buildSearch(t, map[string]string{"wiki/target.md": "needle"})
			mustWrite(t, filepath.Join(root, "wiki", "unrelated.md"), "new generation")
			result, err := index.Search(context.Background(), query, SearchOptions{})
			if !errors.Is(err, ErrStaleIndex) || len(result.Hits) != 0 {
				t.Fatalf("result=%#v err=%v", result, err)
			}
		})
	}
	index, _ := buildSearch(t, map[string]string{"wiki/target.md": "needle"})
	for _, query := range []string{"", "!!!", "missing-term"} {
		result, err := index.Search(context.Background(), query, SearchOptions{})
		if err != nil || len(result.Hits) != 0 {
			t.Fatalf("unchanged %q = %#v, %v", query, result, err)
		}
	}
}

func TestGenerationValidationPrecedesZeroHitCitationAndUnknownHydration(t *testing.T) {
	index, root := buildSearch(t, map[string]string{"wiki/target.md": "needle"})
	mustWrite(t, filepath.Join(root, "wiki", "unrelated.md"), "new generation")
	random := &countingRandom{}
	reader, citations, err := NewCitationReader(context.Background(), index, nil, CitationOptions{Random: random})
	if !errors.Is(err, ErrStaleIndex) || reader != nil || citations != nil || random.reads != 0 {
		t.Fatalf("zero citation = %v %#v %v reads=%d", reader, citations, err, random.reads)
	}
	if _, err := index.ValidateChunk(context.Background(), "0000000000000000000000000000000000000000000000000000000000000000", 1); !errors.Is(err, ErrStaleIndex) {
		t.Fatalf("unknown stale hydration = %v", err)
	}
	current, _ := buildSearch(t, map[string]string{"wiki/target.md": "needle"})
	reader, citations, err = NewCitationReader(context.Background(), current, nil, CitationOptions{Random: random})
	if err != nil || reader == nil || len(citations) != 0 || random.reads != 0 {
		t.Fatalf("current zero citation = %v %#v %v", reader, citations, err)
	}
}

func TestPublicEvidenceOperationsScanCurrentGenerationOnce(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/target.md": "needle", "wiki/other.md": "other"})
	assertReads := func(name string, operation func() error) {
		t.Helper()
		reads := 0
		index.corpus.afterRead = func(string, int) { reads++ }
		if err := operation(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if reads != 2 {
			t.Fatalf("%s scanned %d document reads", name, reads)
		}
	}
	var search SearchResult
	assertReads("search", func() error {
		var err error
		search, err = index.Search(context.Background(), "needle", SearchOptions{})
		return err
	})
	assertReads("hydrate", func() error { _, err := index.ValidateChunk(context.Background(), search.Hits[0].ID, 1); return err })
	var reader *CitationReader
	var citations []Citation
	assertReads("citation constructor", func() error {
		var err error
		reader, citations, err = NewCitationReader(context.Background(), index, search.Hits, CitationOptions{})
		return err
	})
	assertReads("citation read", func() error { _, err := reader.ReadCitationNote(context.Background(), citations[0].ID); return err })
}
