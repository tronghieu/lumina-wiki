package index

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type cancelAfterEmbedder struct {
	cancel context.CancelFunc
	calls  int
}

func (p *cancelAfterEmbedder) Embed(_ context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	p.calls++
	vectors := make([][]float32, len(request.Inputs))
	for i := range vectors {
		vectors[i] = []float32{1, 2, 3}
	}
	p.cancel()
	return EmbeddingBatch{Model: "model", Dimensions: 3, Vectors: vectors}, nil
}

func TestCancellationBetweenBatchesLeavesPointerAndProgressMonotonic(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	initial := requestFor(provider, buildChunk("1", "initial", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), initial, nil); err != nil {
		t.Fatal(err)
	}
	pointer, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	ctx, cancel := context.WithCancel(context.Background())
	cancelling := &cancelAfterEmbedder{cancel: cancel}
	chunks := make([]retrieval.Chunk, MaxEmbeddingBatch+1)
	for i := range chunks {
		text := fmt.Sprintf("changed-%d", i)
		path := fmt.Sprintf("wiki/note-%d.md", i)
		hash := retrieval.ContentHash(text)
		chunks[i] = retrieval.Chunk{ID: retrieval.ChunkID(path, 0, len([]rune(text)), hash), Path: path, Text: text,
			ContentHash: hash, SnapshotHash: strings.Repeat("b", 64), Start: 0, End: len([]rune(text))}
	}
	request := requestFor(cancelling, chunks...)
	var progress []Progress
	_, err := store.Build(ctx, request, func(_ context.Context, update Progress) error { progress = append(progress, update); return nil })
	if !errors.Is(err, context.Canceled) || cancelling.calls != 1 {
		t.Fatalf("cancel: calls=%d err=%v", cancelling.calls, err)
	}
	after, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if string(after) != string(pointer) {
		t.Fatal("partial batch changed pointer")
	}
	for i, update := range progress {
		if update.Completed < 0 || update.Completed > update.Total || i > 0 && (update.Completed < progress[i-1].Completed || update.Total != progress[i-1].Total) {
			t.Fatalf("non-monotonic progress: %#v", progress)
		}
	}
}
