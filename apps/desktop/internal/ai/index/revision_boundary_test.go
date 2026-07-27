package index

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestPhaseBRevisionCheckDoesNotReadGenerationPayload(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &recordingEmbedder{dims: 3}
	initial := requestFor(provider, buildChunk("1", "initial", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), initial, nil); err != nil {
		t.Fatal(err)
	}
	manifestRaw, err := os.ReadFile(filepath.Join(store.workspaceDir, manifestName))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := DecodeManifest(manifestRaw)
	if err != nil {
		t.Fatal(err)
	}
	vectorsPath := filepath.Join(store.workspaceDir, "vectors."+manifest.Generation+".f32")
	changed := requestFor(provider, buildChunk("2", "changed", strings.Repeat("b", 64)))
	var once sync.Once
	status, err := store.Build(context.Background(), changed, func(context.Context, Progress) error {
		once.Do(func() {
			file, openErr := os.OpenFile(vectorsPath, os.O_WRONLY, 0o600)
			if openErr != nil {
				t.Fatal(openErr)
			}
			if truncateErr := file.Truncate(MaxVectorBytes + 1); truncateErr != nil {
				t.Fatal(truncateErr)
			}
			_ = file.Close()
		})
		return nil
	})
	if err != nil || status.State != StateReady {
		t.Fatalf("phase B read payload: %#v %v", status, err)
	}
	loaded, err := store.Status(context.Background(), StatusRequest{})
	if err != nil || loaded.State != StateReady {
		t.Fatalf("replacement invalid: %#v %v", loaded, err)
	}
}
