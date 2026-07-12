package index

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func TestEmptyBuildRejectsCorruptPointerWithoutDeletingFiles(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	request := requestFor(&recordingEmbedder{dims: 3}, buildChunk("1", "first", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(store.workspaceDir, manifestName)
	if err := os.WriteFile(path, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	before := readIndexFiles(t, store.workspaceDir)
	request.Chunks = nil
	if _, err := store.Build(context.Background(), request, nil); err == nil {
		t.Fatal("empty build cleared corrupt index")
	}
	if after := readIndexFiles(t, store.workspaceDir); after != before {
		t.Fatal("corrupt cache changed")
	}
	if _, err := store.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status, _ := store.Status(context.Background(), StatusRequest{}); status.State != StateEmpty {
		t.Fatalf("explicit clear: %#v", status)
	}
}

func TestFinalProgressCancellationPreventsPointerCommit(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	first := requestFor(provider, buildChunk("1", "first", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), first, nil); err != nil {
		t.Fatal(err)
	}
	pointer, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	ctx, cancel := context.WithCancel(context.Background())
	second := requestFor(provider, buildChunk("2", "second", strings.Repeat("b", 64)))
	_, err := store.Build(ctx, second, func(_ context.Context, update Progress) error {
		if update.Total > 0 && update.Completed == update.Total {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("final cancellation: %v", err)
	}
	after, _ := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if string(after) != string(pointer) {
		t.Fatal("canceled final stage committed pointer")
	}
}

func TestLargeOwnedTempDoesNotBrickOperations(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	root, err := store.openRoot()
	if err != nil {
		t.Fatal(err)
	}
	root.Close()
	path := filepath.Join(store.workspaceDir, ".index-tmp-crash")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(MaxVectorBytes + 1); err != nil {
		t.Fatal(err)
	}
	file.Close()
	if status, err := store.Status(context.Background(), StatusRequest{}); err != nil || status.State != StateEmpty {
		t.Fatalf("status: %#v %v", status, err)
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temp remains: %v", err)
	}
}

func TestBuildRejectsForgedChunkAuthenticityBeforeIO(t *testing.T) {
	base := t.TempDir()
	valid := buildChunk("1", "éx", strings.Repeat("b", 64))
	mutations := map[string]func(*retrieval.Chunk){
		"id":         func(c *retrieval.Chunk) { c.ID = strings.Repeat("f", 64) },
		"empty span": func(c *retrieval.Chunk) { c.End = c.Start },
		"byte span":  func(c *retrieval.Chunk) { c.End = c.Start + len(c.Text) },
		"hash":       func(c *retrieval.Chunk) { c.ContentHash = strings.Repeat("e", 64) },
		"snapshot":   func(c *retrieval.Chunk) { c.SnapshotHash = strings.Repeat("d", 64) },
		"path":       func(c *retrieval.Chunk) { c.Path = "wiki/../escape.md" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			store, _ := newTestStore(base, testWorkspace)
			chunk := valid
			mutate(&chunk)
			provider := &recordingEmbedder{dims: 3}
			if _, err := store.Build(context.Background(), requestFor(provider, chunk), nil); err == nil {
				t.Fatal("forged chunk accepted")
			}
			if len(provider.calls) != 0 {
				t.Fatal("provider called")
			}
		})
	}
	if valid.End-valid.Start != utf8.RuneCountInString(valid.Text) {
		t.Fatal("fixture span invalid")
	}
	overlap := valid
	overlap.Start, overlap.End = 10, 10+utf8.RuneCountInString(overlap.Text)
	overlap.ID = retrieval.ChunkID(overlap.Path, overlap.Start, overlap.End, overlap.ContentHash)
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	if _, err := store.Build(context.Background(), requestFor(&recordingEmbedder{dims: 3}, overlap), nil); err != nil {
		t.Fatalf("valid overlap rejected: %v", err)
	}
}

func TestPublicStoreConstructorHasNoCachePathParameter(t *testing.T) {
	if got := reflect.TypeOf(NewStore).NumIn(); got != 1 {
		t.Fatalf("NewStore accepts %d parameters", got)
	}
}
