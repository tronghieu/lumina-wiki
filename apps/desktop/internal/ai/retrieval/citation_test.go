package retrieval

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
)

type countingRandom struct{ reads int }

func (random *countingRandom) Read(value []byte) (int, error) {
	random.reads++
	for index := range value {
		value[index] = byte(index + 1)
	}
	return len(value), nil
}

func TestCitationReaderIssuesOpaqueDeduplicatedIDsAndReadsBroadNote(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/custom-folder/note.md": "# Topic\n\nneedle body"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	hits := append(search.Hits, search.Hits[0])
	reader, citations, err := NewCitationReader(context.Background(), index, hits, CitationOptions{Random: bytes.NewReader(bytes.Repeat([]byte{0x2a}, 64))})
	if err != nil {
		t.Fatal(err)
	}
	if len(citations) != 1 || citations[0].ID != "cit_2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a" || strings.Contains(citations[0].ID, "wiki") {
		t.Fatalf("citations = %#v", citations)
	}
	note, err := reader.ReadCitationNote(context.Background(), citations[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if note.Path != "wiki/custom-folder/note.md" || note.Heading != "Topic" || note.Content != "# Topic\n\nneedle body" {
		t.Fatalf("note = %#v", note)
	}
}

func TestCitationReaderRejectsMalformedUnknownCollisionAndStale(t *testing.T) {
	index, root := buildSearch(t, map[string]string{"wiki/a.md": "needle", "wiki/b.md": "needle"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	reader, citations, err := NewCitationReader(context.Background(), index, search.Hits[:1], CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadCitationNote(context.Background(), "../wiki/a.md"); !errors.Is(err, ErrMalformedCitation) {
		t.Fatalf("malformed = %v", err)
	}
	if _, err := reader.ReadCitationNote(context.Background(), "cit_00000000000000000000000000000000"); !errors.Is(err, ErrUnknownCitation) {
		t.Fatalf("unknown = %v", err)
	}
	collision := bytes.NewReader(bytes.Repeat([]byte{1}, 64))
	if _, _, err := NewCitationReader(context.Background(), index, search.Hits, CitationOptions{Random: collision}); !errors.Is(err, ErrDuplicateCitation) {
		t.Fatalf("collision = %v", err)
	}
	mustWrite(t, root+"/wiki/a.md", "changed needle")
	if _, err := reader.ReadCitationNote(context.Background(), citations[0].ID); !errors.Is(err, ErrStaleIndex) {
		t.Fatalf("stale = %v", err)
	}

}

func TestCitationReaderRejectsSameByteFileReplacement(t *testing.T) {
	index, root := buildSearch(t, map[string]string{"wiki/replaced.md": "same needle bytes"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	reader, citations, err := NewCitationReader(context.Background(), index, search.Hits, CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	replaceSameBytes(t, root+"/wiki/replaced.md")
	if _, err := reader.ReadCitationNote(context.Background(), citations[0].ID); !errors.Is(err, ErrStaleIndex) {
		t.Fatalf("replacement accepted = %v", err)
	}
}

func TestCitationReaderIsolationConcurrencyCapsCloseAndCancellation(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "alpha", "wiki/b.md": "beta"})
	a, err := index.Search(context.Background(), "alpha", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	b, err := index.Search(context.Background(), "beta", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	readerA, idsA, err := NewCitationReader(context.Background(), index, a.Hits, CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	readerB, _, err := NewCitationReader(context.Background(), index, b.Hits, CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := readerB.ReadCitationNote(context.Background(), idsA[0].ID); !errors.Is(err, ErrUnknownCitation) {
		t.Fatalf("isolation = %v", err)
	}
	var wait sync.WaitGroup
	for i := 0; i < 16; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := readerA.ReadCitationNote(context.Background(), idsA[0].ID); err != nil {
				t.Errorf("concurrent read: %v", err)
			}
		}()
	}
	wait.Wait()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := readerA.ReadCitationNote(ctx, idsA[0].ID); err != context.Canceled {
		t.Fatalf("cancel = %v", err)
	}
	readerA.Close()
	if _, err := readerA.ReadCitationNote(context.Background(), idsA[0].ID); !errors.Is(err, ErrCitationClosed) {
		t.Fatalf("closed = %v", err)
	}
	tooMany := make([]Hit, MaxCitationsPerSession+1)
	for i := range tooMany {
		tooMany[i] = a.Hits[0]
		tooMany[i].ID = fmt.Sprintf("%064x", i+1)
		tooMany[i].sealedChunkID = tooMany[i].ID
	}
	if _, _, err := NewCitationReader(context.Background(), index, tooMany, CitationOptions{}); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("cap = %v", err)
	}
}

func TestCitationReaderCapsRawInputsBeforeDedupSnapshotOrRandom(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "needle"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	random := &countingRandom{}
	reads := 0
	index.corpus.afterRead = func(string, int) { reads++ }
	oversized := make([]Hit, MaxCitationInputHits+1)
	for i := range oversized {
		oversized[i] = search.Hits[0]
	}
	reader, citations, err := NewCitationReader(context.Background(), index, oversized, CitationOptions{Random: random})
	if !errors.Is(err, ErrLimitReached) || reader != nil || citations != nil || random.reads != 0 || reads != 0 {
		t.Fatalf("oversized = reader:%v citations:%#v random:%d source:%d err:%v", reader, citations, random.reads, reads, err)
	}
	boundary := make([]Hit, MaxCitationInputHits)
	for i := range boundary {
		boundary[i] = search.Hits[0]
	}
	reader, citations, err = NewCitationReader(context.Background(), index, boundary, CitationOptions{Random: random})
	if err != nil || reader == nil || len(citations) != 1 || random.reads != 1 {
		t.Fatalf("boundary = reader:%v citations:%#v reads:%d err:%v", reader, citations, random.reads, err)
	}
}
