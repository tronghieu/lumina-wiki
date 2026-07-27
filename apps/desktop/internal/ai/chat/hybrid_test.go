package chat

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type semanticSearchFunc func(context.Context, index.SemanticSearchRequest) ([]retrieval.SemanticHit, error)

func (f semanticSearchFunc) Search(ctx context.Context, request index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
	return f(ctx, request)
}

type queryEmbedder struct {
	request index.EmbeddingRequest
	batch   index.EmbeddingBatch
	err     error
}

func (provider *queryEmbedder) Embed(_ context.Context, request index.EmbeddingRequest) (index.EmbeddingBatch, error) {
	provider.request = request
	return provider.batch, provider.err
}

type embeddingSpy struct{ calls int }

func (spy *embeddingSpy) Embed(context.Context, index.EmbeddingRequest) (index.EmbeddingBatch, error) {
	spy.calls++
	return index.EmbeddingBatch{}, nil
}

func TestHybridRetrieverSemanticQueryFusesAndHydratesSemanticOnlyID(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/lexical.md": "needle", "wiki/semantic.md": "meaning only"})
	lexicalDoc, _ := lexical.Search(context.Background(), "needle", retrieval.SearchOptions{})
	semanticDoc, _ := lexical.Search(context.Background(), "meaning", retrieval.SearchOptions{})
	provider := &queryEmbedder{batch: index.EmbeddingBatch{Model: "embed", Dimensions: 2, Vectors: [][]float32{{1, 2}}}}
	var got index.SemanticSearchRequest
	store := semanticSearchFunc(func(_ context.Context, request index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
		got = request
		return []retrieval.SemanticHit{{ChunkID: semanticDoc.Hits[0].ID, Score: .9, Rank: 1}, {ChunkID: lexicalDoc.Hits[0].ID, Score: .8, Rank: 2}}, nil
	})
	metadata := SemanticMetadata{Enabled: true, SnapshotHash: strings.Repeat("b", 64), ProfileFingerprint: strings.Repeat("a", 64), ChunkerVersion: retrieval.ChunkVersion, ExpectedModel: "embed", Dimensions: 2}
	result, err := NewHybridRetriever(HybridConfig{Lexical: lexical, Semantic: store, Provider: provider, Metadata: metadata}).Retrieve(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if provider.request.Purpose != index.PurposeQuery || len(provider.request.Inputs) != 1 || provider.request.Inputs[0] != "needle" || got.Dimensions != 2 || got.SnapshotHash != metadata.SnapshotHash {
		t.Fatalf("embed=%#v search=%#v", provider.request, got)
	}
	foundSemantic := false
	for _, hit := range result.Hits {
		if hit.ID == semanticDoc.Hits[0].ID {
			foundSemantic = true
		}
	}
	if len(result.Hits) != 2 || result.Hits[0].ID != lexicalDoc.Hits[0].ID || !foundSemantic || result.SemanticStatus != retrieval.SemanticReady {
		t.Fatalf("result=%#v", result)
	}
}

func TestHybridRetrieverSemanticFailureIsStableLexicalFallback(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	provider := &queryEmbedder{err: errors.New("endpoint secret")}
	result, err := NewHybridRetriever(HybridConfig{Lexical: lexical, Semantic: semanticSearchFunc(func(context.Context, index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
		t.Fatal("search called")
		return nil, nil
	}), Provider: provider, Metadata: SemanticMetadata{Enabled: true}}).Retrieve(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil || result.SemanticStatus != retrieval.SemanticUnavailable || result.WarningCode != retrieval.WarningSemanticUnavailable || len(result.Hits) != 1 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestHybridRetrieverHydrationAndLexicalStaleReturnsStableError(t *testing.T) {
	lexical, root := testIndex(t, map[string]string{"wiki/lexical.md": "needle", "wiki/semantic.md": "meaning"})
	semanticDoc, _ := lexical.Search(context.Background(), "meaning", retrieval.SearchOptions{})
	provider := &queryEmbedder{batch: index.EmbeddingBatch{Model: "embed", Dimensions: 2, Vectors: [][]float32{{1, 2}}}}
	calls := 0
	store := semanticSearchFunc(func(_ context.Context, _ index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
		calls++
		if err := os.WriteFile(filepath.Join(root, "wiki", "semantic.md"), []byte("meaning changed"), 0o600); err != nil {
			t.Fatal(err)
		}
		return []retrieval.SemanticHit{{ChunkID: semanticDoc.Hits[0].ID, Score: .9, Rank: 1}}, nil
	})
	metadata := SemanticMetadata{Enabled: true, SnapshotHash: strings.Repeat("b", 64), ProfileFingerprint: strings.Repeat("a", 64), ChunkerVersion: retrieval.ChunkVersion, ExpectedModel: "embed", Dimensions: 2}
	result, err := NewHybridRetriever(HybridConfig{Lexical: lexical, Semantic: store, Provider: provider, Metadata: metadata}).Retrieve(context.Background(), "needle", retrieval.SearchOptions{})
	if !errors.Is(err, retrieval.ErrStaleIndex) || calls != 1 || len(result.Hits) != 0 {
		t.Fatalf("result=%#v calls=%d err=%v", result, calls, err)
	}
}

func TestHybridRetrieverUnknownSemanticIDFallsBackToFreshLexical(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	provider := &queryEmbedder{batch: index.EmbeddingBatch{Model: "embed", Dimensions: 1, Vectors: [][]float32{{1}}}}
	store := semanticSearchFunc(func(context.Context, index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
		return []retrieval.SemanticHit{{ChunkID: strings.Repeat("f", 64), Score: .9, Rank: 1}}, nil
	})
	metadata := SemanticMetadata{Enabled: true, SnapshotHash: strings.Repeat("b", 64), ProfileFingerprint: strings.Repeat("a", 64), ChunkerVersion: retrieval.ChunkVersion, ExpectedModel: "embed", Dimensions: 1}
	result, err := NewHybridRetriever(HybridConfig{Lexical: lexical, Semantic: store, Provider: provider, Metadata: metadata}).Retrieve(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil || result.SemanticStatus != retrieval.SemanticStale || len(result.Hits) != 1 || result.Hits[0].Path != "wiki/a.md" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestHybridRetrieverSemanticFaultPreservesSelectedAndLinkedBoosts(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle", "wiki/b.md": "needle", "wiki/c.md": "needle"})
	provider := &queryEmbedder{batch: index.EmbeddingBatch{Model: "embed", Dimensions: 1, Vectors: [][]float32{{1}}}}
	store := semanticSearchFunc(func(context.Context, index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
		return nil, retrieval.ErrSemanticCorrupt
	})
	metadata := SemanticMetadata{Enabled: true, SnapshotHash: strings.Repeat("b", 64), ProfileFingerprint: strings.Repeat("a", 64), ChunkerVersion: retrieval.ChunkVersion, ExpectedModel: "embed", Dimensions: 1}
	result, err := NewHybridRetriever(HybridConfig{Lexical: lexical, Semantic: store, Provider: provider, Metadata: metadata}).Retrieve(context.Background(), "needle", retrieval.SearchOptions{SelectedPath: "wiki/b.md", LinkedPaths: []string{"wiki/c.md"}})
	if err != nil || result.SemanticStatus != retrieval.SemanticCorrupt || len(result.Hits) != 3 || result.Hits[0].Path != "wiki/b.md" || result.Hits[1].Path != "wiki/c.md" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestHybridRetrieverDisabledUsesLexicalWithoutProvider(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	provider := &embeddingSpy{}
	retriever := NewHybridRetriever(HybridConfig{Lexical: lexical, Provider: provider})
	result, err := retriever.Retrieve(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hits) != 1 || result.SemanticStatus != retrieval.SemanticDisabled || provider.calls != 0 {
		t.Fatalf("result=%#v calls=%d", result, provider.calls)
	}
}

func TestHybridRetrieverPropagatesCancellationBeforeDependencies(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := NewHybridRetriever(HybridConfig{}).Retrieve(ctx, "needle", retrieval.SearchOptions{})
	if err != context.Canceled || len(result.Hits) != 0 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestHybridRetrieverEnabledMissingSemanticDependencyIsUnavailable(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	result, err := NewHybridRetriever(HybridConfig{Lexical: lexical, Metadata: SemanticMetadata{Enabled: true}}).Retrieve(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if result.SemanticStatus != retrieval.SemanticUnavailable || result.WarningCode != retrieval.WarningSemanticUnavailable || len(result.Hits) != 1 {
		t.Fatalf("result=%#v", result)
	}
}
