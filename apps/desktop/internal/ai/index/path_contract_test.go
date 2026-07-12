package index

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func TestLexicalChunksWithDoubleDotComponentBuildSemanticIndex(t *testing.T) {
	workspace := t.TempDir()
	if err := os.Mkdir(filepath.Join(workspace, "wiki"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "README.md"), []byte("workspace"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "wiki", "version..notes.md"), []byte("# Version\n\nprivate notes"), 0o600); err != nil {
		t.Fatal(err)
	}
	lexical, err := retrieval.BuildLexical(context.Background(), nil, workspace)
	if err != nil {
		t.Fatal(err)
	}
	chunks, err := lexical.Chunks(context.Background())
	if err != nil || len(chunks) != 1 || chunks[0].Path != "wiki/version..notes.md" {
		t.Fatalf("chunks: %#v %v", chunks, err)
	}
	store, err := newTestStore(t.TempDir(), testWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	request := requestFor(&recordingEmbedder{dims: 3}, chunks...)
	request.SnapshotHash = chunks[0].SnapshotHash
	status, err := store.Build(context.Background(), request, nil)
	if err != nil || status.State != StateReady {
		t.Fatalf("semantic build: %#v %v", status, err)
	}
}

func TestTraversalSegmentRejectedWithOtherwiseAuthenticChunk(t *testing.T) {
	chunk := buildChunk("1", "private", strings.Repeat("b", 64))
	chunk.Path = "wiki/../escape.md"
	chunk.ID = retrieval.ChunkID(chunk.Path, chunk.Start, chunk.End, chunk.ContentHash)
	store, err := newTestStore(t.TempDir(), testWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	provider := &recordingEmbedder{dims: 3}
	if _, err := store.Build(context.Background(), requestFor(provider, chunk), nil); err == nil {
		t.Fatal("traversal segment accepted")
	}
	if len(provider.calls) != 0 {
		t.Fatal("provider called for invalid path")
	}
}
