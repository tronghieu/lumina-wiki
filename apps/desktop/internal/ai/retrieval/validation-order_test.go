package retrieval

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
)

func TestInvalidSearchInputsDoNotSnapshotCorpus(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "needle"})
	linked := make([]string, MaxLinkedPathInputs+1)
	for i := range linked {
		linked[i] = "wiki/a.md"
	}
	cases := []struct {
		name    string
		query   string
		options SearchOptions
	}{
		{"oversized query", strings.Repeat("x", MaxQueryBytes+1), SearchOptions{}},
		{"invalid utf8", string([]byte{0xff}), SearchOptions{}},
		{"excess linked inputs", "needle", SearchOptions{LinkedPaths: linked}},
		{"invalid selected path", "needle", SearchOptions{SelectedPath: "../wiki/a.md"}},
		{"invalid limit", "needle", SearchOptions{Limit: MaxSearchResults + 1}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			reads := 0
			index.corpus.afterRead = func(string, int) { reads++ }
			if _, err := index.Search(context.Background(), test.query, test.options); !errors.Is(err, ErrLimitReached) {
				t.Fatalf("err = %v", err)
			}
			if reads != 0 {
				t.Fatalf("invalid input scanned %d reads", reads)
			}
		})
	}
}

func TestInvalidHydrationInputsDoNotSnapshotCorpus(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "needle"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		id    string
		score float64
	}{
		{"bad", 1},
		{search.Hits[0].ID, math.NaN()},
		{search.Hits[0].ID, math.Inf(1)},
	}
	for _, test := range cases {
		reads := 0
		index.corpus.afterRead = func(string, int) { reads++ }
		if _, err := index.ValidateChunk(context.Background(), test.id, test.score); err == nil {
			t.Fatal("invalid hydration accepted")
		}
		if reads != 0 {
			t.Fatalf("invalid hydration scanned %d reads", reads)
		}
	}
}

func TestInvalidCitationSealsDoNotSnapshotCorpus(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "needle"})
	reads := 0
	index.corpus.afterRead = func(string, int) { reads++ }
	if _, _, err := NewCitationReader(context.Background(), index, []Hit{{Chunk: Chunk{ID: strings.Repeat("a", 64)}}}, CitationOptions{}); !errors.Is(err, ErrUnsealedHit) {
		t.Fatalf("err = %v", err)
	}
	if reads != 0 {
		t.Fatalf("invalid citation scanned %d reads", reads)
	}
}
