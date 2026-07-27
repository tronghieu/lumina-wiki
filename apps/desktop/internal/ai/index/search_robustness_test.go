package index

import (
	"context"
	"encoding/binary"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func readySearchStore(t *testing.T) (*Store, SemanticSearchRequest) {
	t.Helper()
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	snapshot := strings.Repeat("b", 64)
	request := requestFor(&fixedEmbedder{vectors: [][]float32{{1, 0}}}, buildChunk("1", "one", snapshot))
	request.ExpectedDimensions = 2
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	return store, SemanticSearchRequest{Query: []float32{1, 0}, Limit: 1, SnapshotHash: snapshot,
		ChunkerVersion: retrieval.ChunkVersion, ProfileFingerprint: strings.Repeat("a", 64), Dimensions: 2}
}

func TestSearchCopiesQueryAndDoesNotBlockStatus(t *testing.T) {
	store, request := readySearchStore(t)
	opened, release := make(chan struct{}), make(chan struct{})
	store.searchAfterOpen = func() { close(opened); <-release }
	type outcome struct {
		hits []retrieval.SemanticHit
		err  error
	}
	done := make(chan outcome, 1)
	go func() { hits, err := store.Search(context.Background(), request); done <- outcome{hits, err} }()
	<-opened
	request.Query[0], request.Query[1] = 0, 1
	statusDone := make(chan IndexStatus, 1)
	go func() { status, _ := store.Status(context.Background(), StatusRequest{}); statusDone <- status }()
	if status := <-statusDone; status.State != StateReady {
		t.Fatalf("status=%#v", status)
	}
	close(release)
	result := <-done
	if result.err != nil || len(result.hits) != 1 || result.hits[0].Score != 1 {
		t.Fatalf("search=%#v,%v", result.hits, result.err)
	}
}

func TestSearchClearDuringScanReturnsStale(t *testing.T) {
	store, request := readySearchStore(t)
	opened, release := make(chan struct{}), make(chan struct{})
	store.searchAfterOpen = func() { close(opened); <-release }
	done := make(chan error, 1)
	go func() { _, err := store.Search(context.Background(), request); done <- err }()
	<-opened
	if _, err := store.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; !errors.Is(err, ErrSemanticStale) {
		t.Fatalf("clear race=%v", err)
	}
}

func TestSearchRejectsCorruptVectorBytes(t *testing.T) {
	for _, mutation := range []string{"truncate", "extra", "nan", "zero"} {
		t.Run(mutation, func(t *testing.T) {
			store, request := readySearchStore(t)
			manifestRaw, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
			manifest, _ := DecodeManifest(manifestRaw)
			path := filepath.Join(store.workspaceDir, "vectors."+manifest.Generation+".f32")
			raw, _ := os.ReadFile(path)
			switch mutation {
			case "truncate":
				raw = raw[:len(raw)-1]
			case "extra":
				raw = append(raw, 0)
			case "nan":
				binary.LittleEndian.PutUint32(raw, math.Float32bits(float32(math.NaN())))
			case "zero":
				clear(raw)
			}
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			if hits, err := store.Search(context.Background(), request); !errors.Is(err, ErrSemanticCorrupt) || len(hits) != 0 {
				t.Fatalf("result=%#v,%v", hits, err)
			}
		})
	}
}

func TestSearchValidatesBeforeCacheIOAndHonorsCancellation(t *testing.T) {
	store := &Store{}
	if _, err := store.Search(context.Background(), SemanticSearchRequest{}); !errors.Is(err, ErrSemanticUnavailable) {
		t.Fatalf("validation=%v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.Search(ctx, SemanticSearchRequest{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
}
