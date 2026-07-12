package index

import (
	"context"
	"errors"
	"math"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func TestCosineExactNumericsAndValidation(t *testing.T) {
	tests := []struct {
		a, b []float32
		want float64
	}{{[]float32{1, 2, 3}, []float32{1, 2, 3}, 1},
		{[]float32{1, 0}, []float32{0, 1}, 0},
		{[]float32{1, 2}, []float32{-1, -2}, -1},
		{[]float32{1e30, 2e30}, []float32{2e30, 4e30}, 1},
		{[]float32{1e-30, 2e-30}, []float32{2e-30, 4e-30}, 1}}
	for _, test := range tests {
		got, err := CosineExact(test.a, test.b)
		if err != nil || math.Abs(got-test.want) > 1e-14 {
			t.Fatalf("CosineExact(%v,%v)=%g,%v", test.a, test.b, got, err)
		}
		first := math.Float64bits(got)
		for range 20 {
			repeated, _ := CosineExact(test.a, test.b)
			if math.Float64bits(repeated) != first {
				t.Fatal("nondeterministic cosine")
			}
		}
	}
	bad := []struct{ a, b []float32 }{
		{nil, nil}, {[]float32{1}, []float32{1, 2}}, {[]float32{0}, []float32{1}},
		{[]float32{float32(math.NaN())}, []float32{1}}, {[]float32{float32(math.Inf(1))}, []float32{1}},
	}
	for _, test := range bad {
		if _, err := CosineExact(test.a, test.b); err == nil {
			t.Fatalf("accepted %v %v", test.a, test.b)
		}
	}
}

func TestSearchRanksUniqueVectorsAndRejectsStale(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	snapshot := strings.Repeat("b", 64)
	one := buildChunk("1", "same", snapshot)
	two := buildChunk("2", "same", snapshot)
	three := buildChunk("3", "other", snapshot)
	provider := &fixedEmbedder{vectors: [][]float32{{1, 0}, {0, 1}}}
	request := requestFor(provider, one, two, three)
	request.ExpectedDimensions = 2
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	search := SemanticSearchRequest{Query: []float32{1, 0}, Limit: 3, SnapshotHash: snapshot,
		ChunkerVersion: retrieval.ChunkVersion, ProfileFingerprint: strings.Repeat("a", 64), Dimensions: 2}
	hits, err := store.Search(context.Background(), search)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{one.ID, two.ID, three.ID}
	got := []string{hits[0].ChunkID, hits[1].ChunkID, hits[2].ChunkID}
	if !reflect.DeepEqual(got, want) || hits[0].Rank != 1 || hits[2].Rank != 3 {
		t.Fatalf("hits=%#v", hits)
	}
	search.SnapshotHash = strings.Repeat("c", 64)
	if hits, err = store.Search(context.Background(), search); !errors.Is(err, ErrSemanticStale) || len(hits) != 0 {
		t.Fatalf("stale=%#v,%v", hits, err)
	}
}

func TestBuildRejectsZeroNormVectorBeforeReady(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &fixedEmbedder{vectors: [][]float32{{0, 0, 0}}}
	if _, err := store.Build(context.Background(), requestFor(provider, buildChunk("1", "zero", strings.Repeat("b", 64))), nil); err == nil {
		t.Fatal("zero vector committed")
	}
	status, _ := store.Status(context.Background(), StatusRequest{})
	if status.State != StateEmpty {
		t.Fatalf("status=%#v", status)
	}
}

func TestSearchRejectsGenerationThatChangesDuringScan(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	oldSnapshot := strings.Repeat("b", 64)
	oldChunk := buildChunk("1", "old", oldSnapshot)
	request := requestFor(&fixedEmbedder{vectors: [][]float32{{1, 0}}}, oldChunk)
	request.ExpectedDimensions = 2
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	opened, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	store.searchAfterOpen = func() { once.Do(func() { close(opened); <-release }) }
	done := make(chan error, 1)
	go func() {
		_, err := store.Search(context.Background(), SemanticSearchRequest{Query: []float32{1, 0}, Limit: 1,
			SnapshotHash: oldSnapshot, ChunkerVersion: retrieval.ChunkVersion,
			ProfileFingerprint: strings.Repeat("a", 64), Dimensions: 2})
		done <- err
	}()
	<-opened
	newSnapshot := strings.Repeat("c", 64)
	newChunk := buildChunk("2", "new", newSnapshot)
	request = requestFor(&fixedEmbedder{vectors: [][]float32{{0, 1}}}, newChunk)
	request.SnapshotHash, request.ExpectedDimensions = newSnapshot, 2
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; !errors.Is(err, ErrSemanticStale) {
		t.Fatalf("race=%v", err)
	}
}

type fixedEmbedder struct{ vectors [][]float32 }

func (p *fixedEmbedder) Embed(_ context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	vectors := p.vectors[:len(request.Inputs)]
	return EmbeddingBatch{Model: "model", Dimensions: len(vectors[0]), Vectors: vectors}, nil
}
