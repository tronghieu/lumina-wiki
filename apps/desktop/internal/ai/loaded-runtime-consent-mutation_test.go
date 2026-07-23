package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func TestLoadedRuntimeConsentMutationReservesIndexCoordinator(t *testing.T) {
	store := &runtimeSemanticStore{clearStatus: index.IndexStatus{State: index.StateEmpty}}
	runtime := semanticRuntime(t, runtimeWorkspace(t), store, nil)
	if _, err := runtime.ClearIndexForConsent(context.Background(), "embed-main"); !errors.Is(err, ErrIndexBuildActive) {
		t.Fatalf("unreserved clear err=%v", err)
	}
	done, err := runtime.BeginConsentMutation(context.Background(), "embed-main")
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	if status, err := runtime.ClearIndexForConsent(context.Background(), "embed-main"); err != nil || status.State != index.StateEmpty {
		t.Fatalf("reserved clear=%#v err=%v", status, err)
	}
	if _, err := runtime.BuildIndex(context.Background(), "embed-main"); err != ErrIndexBuildActive {
		t.Fatalf("build err=%v", err)
	}
	if _, err := runtime.ClearIndex(context.Background(), "embed-main"); err != ErrIndexBuildActive {
		t.Fatalf("clear err=%v", err)
	}
}

type multiBatchConsentStore struct {
	runtimeSemanticStore
	firstBatch chan struct{}
	committed  bool
}

func (store *multiBatchConsentStore) Build(ctx context.Context, request index.BuildRequest, _ index.ProgressSink) (index.IndexStatus, error) {
	if len(request.Chunks) <= index.MaxEmbeddingBatch {
		return index.IndexStatus{}, errors.New("test corpus is not multi-batch")
	}
	inputs := make([]string, index.MaxEmbeddingBatch)
	for i := range inputs {
		inputs[i] = request.Chunks[i].Text
	}
	_, _ = request.Provider.Embed(ctx, index.EmbeddingRequest{Purpose: index.PurposeDocument, Inputs: inputs})
	close(store.firstBatch)
	<-ctx.Done()
	return index.IndexStatus{State: index.StateFailed}, ctx.Err()
}

type mutationEmbedder struct{ calls int }

func (embedder *mutationEmbedder) Embed(context.Context, index.EmbeddingRequest) (index.EmbeddingBatch, error) {
	embedder.calls++
	return index.EmbeddingBatch{Model: "model", Dimensions: 8}, nil
}

type latePublishingStore struct {
	runtimeSemanticStore
	finalCommit chan struct{}
	cancelSeen  chan struct{}
	release     chan struct{}
	committed   bool
	clearCalls  int
}

func (store *latePublishingStore) Build(ctx context.Context, _ index.BuildRequest, _ index.ProgressSink) (index.IndexStatus, error) {
	close(store.finalCommit)
	<-ctx.Done()
	close(store.cancelSeen)
	<-store.release
	store.committed = true
	return index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8}, nil
}

func (store *latePublishingStore) Clear(context.Context) (index.IndexStatus, error) {
	store.clearCalls++
	store.committed = false
	return index.IndexStatus{State: index.StateEmpty}, nil
}

func TestLoadedRuntimeConsentMutationCancelsAndWaitsForMultiBatchBuild(t *testing.T) {
	root := runtimeWorkspace(t)
	for i := 0; i < index.MaxEmbeddingBatch+1; i++ {
		if err := os.WriteFile(filepath.Join(root, "wiki", fmt.Sprintf("note-%03d.md", i)), []byte("embedding evidence"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	store := &multiBatchConsentStore{firstBatch: make(chan struct{})}
	embedder := &mutationEmbedder{}
	runtime := semanticRuntime(t, root, store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) { return embedder, nil })
	buildDone := make(chan error, 1)
	go func() { _, err := runtime.BuildIndex(context.Background(), "embed-main"); buildDone <- err }()
	<-store.firstBatch
	release, err := runtime.BeginConsentMutation(context.Background(), "embed-main")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if err := <-buildDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("build err=%v", err)
	}
	if embedder.calls != 1 || store.committed {
		t.Fatalf("calls=%d committed=%v", embedder.calls, store.committed)
	}
	if _, err := runtime.BuildIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexBuildActive) {
		t.Fatalf("new build err=%v", err)
	}
}

func TestLoadedRuntimeReservedClearRunsAfterLateBuildPublication(t *testing.T) {
	store := &latePublishingStore{finalCommit: make(chan struct{}), cancelSeen: make(chan struct{}), release: make(chan struct{})}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		return &mutationEmbedder{}, nil
	})
	buildDone := make(chan error, 1)
	go func() { _, err := runtime.BuildIndex(context.Background(), "embed-main"); buildDone <- err }()
	<-store.finalCommit
	type reservation struct {
		done func()
		err  error
	}
	reserved := make(chan reservation, 1)
	go func() {
		done, err := runtime.BeginConsentMutation(context.Background(), "embed-main")
		reserved <- reservation{done, err}
	}()
	<-store.cancelSeen
	if _, err := runtime.BuildIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexBuildActive) {
		t.Fatalf("new build err=%v", err)
	}
	close(store.release)
	if err := <-buildDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("late build err=%v", err)
	}
	result := <-reserved
	if result.err != nil {
		t.Fatal(result.err)
	}
	defer result.done()
	if !store.committed {
		t.Fatal("test build did not publish ready")
	}
	if status, err := runtime.ClearIndexForConsent(context.Background(), "embed-main"); err != nil || status.State != index.StateEmpty {
		t.Fatalf("clear=%#v err=%v", status, err)
	}
	if store.committed || store.clearCalls != 1 {
		t.Fatalf("committed=%v clears=%d", store.committed, store.clearCalls)
	}
}
