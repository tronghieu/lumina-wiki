package index

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type countingEmbedder struct{ calls atomic.Int64 }

func (p *countingEmbedder) Embed(_ context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	p.calls.Add(1)
	vectors := make([][]float32, len(request.Inputs))
	for i := range vectors {
		vectors[i] = []float32{1, 2, 3}
	}
	return EmbeddingBatch{Model: "model", Dimensions: 3, Vectors: vectors}, nil
}

func TestManifestTooLargeRejectsBeforeProviderOrCacheWrites(t *testing.T) {
	base := t.TempDir()
	provider := &countingEmbedder{}
	chunks := make([]retrieval.Chunk, MaxIndexChunks)
	for i := range chunks {
		path, text := fmt.Sprintf("wiki/doc-%05d.md", i), fmt.Sprintf("text-%d", i)
		hash := retrieval.ContentHash(text)
		chunks[i] = retrieval.Chunk{ID: retrieval.ChunkID(path, 0, len([]rune(text)), hash), Path: path, Text: text,
			ContentHash: hash, SnapshotHash: strings.Repeat("b", 64), Start: 0, End: len([]rune(text))}
	}
	store, _ := newTestStore(base, testWorkspace)
	before := readIndexFiles(t, store.workspaceDir)
	if _, err := store.Build(context.Background(), requestFor(provider, chunks...), nil); err == nil {
		t.Fatal("oversize manifest accepted")
	}
	if provider.calls.Load() != 0 {
		t.Fatalf("provider called %d times", provider.calls.Load())
	}
	if after := readIndexFiles(t, store.workspaceDir); after != before {
		t.Fatal("cache changed before cap rejection")
	}
}
