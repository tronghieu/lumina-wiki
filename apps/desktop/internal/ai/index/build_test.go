package index

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type recordingEmbedder struct {
	calls [][]string
	dims  int
	err   error
}

func (p *recordingEmbedder) Embed(_ context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	p.calls = append(p.calls, append([]string(nil), request.Inputs...))
	if p.err != nil {
		return EmbeddingBatch{}, p.err
	}
	vectors := make([][]float32, len(request.Inputs))
	for i, input := range request.Inputs {
		vectors[i] = make([]float32, p.dims)
		for j := range vectors[i] {
			vectors[i][j] = float32(len(input) + j + 1)
		}
	}
	return EmbeddingBatch{Model: "model", Dimensions: p.dims, Vectors: vectors}, nil
}

func buildChunk(idByte, text, snapshot string) retrieval.Chunk {
	path := "wiki/" + idByte + ".md"
	end := utf8.RuneCountInString(text)
	hash := retrieval.ContentHash(text)
	return retrieval.Chunk{ID: retrieval.ChunkID(path, 0, end, hash), Path: path, Text: text,
		ContentHash: hash, SnapshotHash: snapshot, Start: 0, End: end}
}

func requestFor(provider EmbeddingProvider, chunks ...retrieval.Chunk) BuildRequest {
	return BuildRequest{WorkspaceID: testWorkspace, Chunks: chunks, SnapshotHash: strings.Repeat("b", 64),
		ChunkerVersion: retrieval.ChunkVersion, ProfileFingerprint: strings.Repeat("a", 64),
		ExpectedModel: "model", ExpectedDimensions: 3, Provider: provider}
}

func TestBuildReusesUnchangedAndDeduplicatesChangedContent(t *testing.T) {
	store, err := newTestStore(t.TempDir(), testWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	provider := &recordingEmbedder{dims: 3}
	one := buildChunk("1", "same private note", strings.Repeat("b", 64))
	two := buildChunk("2", "same private note", strings.Repeat("b", 64))
	if _, err := store.Build(context.Background(), requestFor(provider, one, two), nil); err != nil {
		t.Fatal(err)
	}
	if len(provider.calls) != 1 || len(provider.calls[0]) != 1 {
		t.Fatalf("duplicates embedded: %#v", provider.calls)
	}
	provider.calls = nil
	three := buildChunk("3", "changed private note", strings.Repeat("b", 64))
	if _, err := store.Build(context.Background(), requestFor(provider, one, three), nil); err != nil {
		t.Fatal(err)
	}
	if len(provider.calls) != 1 || len(provider.calls[0]) != 1 || provider.calls[0][0] != three.Text {
		t.Fatalf("incremental calls: %#v", provider.calls)
	}
	if raw := readIndexFiles(t, store.workspaceDir); strings.Contains(raw, one.Text) || strings.Contains(raw, three.Text) {
		t.Fatal("note text persisted in semantic cache")
	}
}

func TestBuildFailureAndCancellationKeepOldPointer(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	chunk := buildChunk("1", "first", strings.Repeat("b", 64))
	if _, err := store.Build(context.Background(), requestFor(provider, chunk), nil); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if err != nil {
		t.Fatal(err)
	}
	failed := &recordingEmbedder{dims: 3, err: errors.New("provider failed")}
	changed := buildChunk("2", "second", strings.Repeat("b", 64))
	if _, err := store.Build(context.Background(), requestFor(failed, changed), nil); err == nil {
		t.Fatal("provider failure accepted")
	}
	after, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if string(after) != string(before) {
		t.Fatal("failed build changed commit pointer")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.Build(ctx, requestFor(provider, changed), nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
}

func TestDynamicDimensionsAndEmptyAvoidProvider(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 5}
	request := requestFor(provider, buildChunk("1", "dynamic", strings.Repeat("b", 64)))
	request.ExpectedDimensions = 0
	status, err := store.Build(context.Background(), request, nil)
	if err != nil || status.Dimensions != 5 {
		t.Fatalf("dynamic: %#v %v", status, err)
	}
	provider.calls = nil
	empty := requestFor(provider)
	empty.ExpectedDimensions = 0
	status, err = store.Build(context.Background(), empty, nil)
	if err != nil || status.State != StateEmpty || len(provider.calls) != 0 {
		t.Fatalf("empty: %#v %#v %v", status, provider.calls, err)
	}
}

func TestProfileDriftForcesFullRebuildAndGCLeavesTwoGenerations(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	one := buildChunk("1", "one", strings.Repeat("b", 64))
	two := buildChunk("2", "two", strings.Repeat("b", 64))
	request := requestFor(provider, one, two)
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	provider.calls = nil
	request.ProfileFingerprint = strings.Repeat("c", 64)
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	if len(provider.calls) != 1 || len(provider.calls[0]) != 2 {
		t.Fatalf("drift reused vectors: %#v", provider.calls)
	}
	provider.calls = nil
	request.Chunks = []retrieval.Chunk{one}
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	if len(provider.calls) != 0 {
		t.Fatalf("delete caused embedding: %#v", provider.calls)
	}
	entries, err := os.ReadDir(store.workspaceDir)
	if err != nil {
		t.Fatal(err)
	}
	generations := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "vectors.") {
			generations++
		}
	}
	if generations != 2 {
		t.Fatalf("retained %d vector generations, want 2", generations)
	}
}

func readIndexFiles(t *testing.T, dir string) string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var all strings.Builder
	for _, entry := range entries {
		if !entry.IsDir() {
			raw, _ := os.ReadFile(filepath.Join(dir, entry.Name()))
			all.Write(raw)
		}
	}
	return all.String()
}
