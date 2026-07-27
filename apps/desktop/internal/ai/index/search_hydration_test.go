package index

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func TestSemanticOnlySearchCanFuseAndHydrateToCitation(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "wiki", "concepts"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# workspace"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "wiki", "concepts", "one.md"), []byte("# One\n\nsemantic body"), 0o600); err != nil {
		t.Fatal(err)
	}
	lexical, err := retrieval.BuildLexical(context.Background(), retrieval.NewCorpus(), root)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := retrieval.NewCorpus().Snapshot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	chunks, err := retrieval.ChunkMarkdown(context.Background(), snapshot.Documents[0], snapshot.SnapshotHash)
	if err != nil {
		t.Fatal(err)
	}
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 2}
	build := requestFor(provider, chunks...)
	build.SnapshotHash, build.ExpectedDimensions = snapshot.SnapshotHash, 2
	for i := range build.Chunks {
		build.Chunks[i].SnapshotHash = snapshot.SnapshotHash
	}
	if _, err := store.Build(context.Background(), build, nil); err != nil {
		t.Fatal(err)
	}
	semantic, err := store.Search(context.Background(), SemanticSearchRequest{Query: []float32{1, 1}, Limit: 1,
		SnapshotHash: snapshot.SnapshotHash, ChunkerVersion: retrieval.ChunkVersion,
		ProfileFingerprint: strings.Repeat("a", 64), Dimensions: 2})
	if err != nil {
		t.Fatal(err)
	}
	fused := retrieval.FuseRanks(nil, semantic, retrieval.RRFK, 1)
	hit, err := lexical.ValidateChunk(context.Background(), fused[0].ChunkID, fused[0].FusedScore)
	if err != nil {
		t.Fatal(err)
	}
	reader, citations, err := retrieval.NewCitationReader(context.Background(), lexical, []retrieval.Hit{hit}, retrieval.CitationOptions{})
	if err != nil || reader == nil || len(citations) != 1 {
		t.Fatalf("citation=%#v,%v", citations, err)
	}
}
