package index

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type invalidEmbedder struct{ batch EmbeddingBatch }

func (provider invalidEmbedder) Embed(context.Context, EmbeddingRequest) (EmbeddingBatch, error) {
	return provider.batch, nil
}

func TestBuildRejectsCorruptCommittedPointer(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	request := requestFor(provider, buildChunk("1", "first", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(store.workspaceDir, manifestName)
	if err := os.WriteFile(path, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	request.Chunks = []retrieval.Chunk{buildChunk("2", "second", strings.Repeat("b", 64))}
	if _, err := store.Build(context.Background(), request, nil); err == nil {
		t.Fatal("corrupt pointer silently replaced")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("corrupt pointer changed")
	}
}

func TestPreCommitSyncFailurePreservesOldPointer(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	first := requestFor(provider, buildChunk("1", "first", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), first, nil); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	store.syncRoot = func(*os.Root) error { return errors.New("generation sync failed") }
	second := requestFor(provider, buildChunk("2", "second", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), second, nil); err == nil {
		t.Fatal("pre-commit sync failure accepted")
	}
	after, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if string(after) != string(before) {
		t.Fatal("pre-commit failure changed pointer")
	}
}

func TestBuildRejectsWrongAndNonFiniteProviderBatches(t *testing.T) {
	chunk := buildChunk("1", "private", strings.Repeat("b", 64))
	for name, batch := range map[string]EmbeddingBatch{
		"wrong dimensions": {Model: "model", Dimensions: 2, Vectors: [][]float32{{1, 2}}},
		"nonfinite":        {Model: "model", Dimensions: 3, Vectors: [][]float32{{1, float32(math.NaN()), 3}}},
		"partial":          {Model: "model", Dimensions: 3, Vectors: nil},
		"wrong model":      {Model: "other", Dimensions: 3, Vectors: [][]float32{{1, 2, 3}}},
	} {
		t.Run(name, func(t *testing.T) {
			store, _ := newTestStore(t.TempDir(), testWorkspace)
			if _, err := store.Build(context.Background(), requestFor(invalidEmbedder{batch}, chunk), nil); err == nil {
				t.Fatal("invalid provider batch accepted")
			}
		})
	}
}
