package ai

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func TestLoadedRuntimeIndexStatusRejectsMismatchedProfileWithoutOpeningStore(t *testing.T) {
	store := &runtimeSemanticStore{status: index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8}}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		t.Fatal("status must not create an embedding provider")
		return nil, nil
	})
	status, err := runtime.IndexStatus(context.Background(), "forged")
	if !errors.Is(err, ErrIndexUnavailable) || status != (index.IndexStatus{}) || store.statusCalls != 0 {
		t.Fatalf("status=%#v err=%v calls=%d", status, err, store.statusCalls)
	}
}

func TestLoadedRuntimeIndexStatusUsesCorpusAndNeverCreatesProvider(t *testing.T) {
	store := &runtimeSemanticStore{status: index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8}}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		t.Fatal("status must not create provider")
		return nil, nil
	})
	status, err := runtime.IndexStatus(context.Background(), "embed-main")
	if err != nil || status.State != index.StateReady || store.statusCalls != 1 || store.statusRequest.SnapshotHash == "" || store.statusRequest.ChunkerVersion == "" || store.statusRequest.ProfileFingerprint == "" || store.statusRequest.Dimensions != 8 {
		t.Fatalf("status=%#v err=%v request=%#v", status, err, store.statusRequest)
	}
}

func TestLoadedRuntimeBuildEmptyDoesNotCreateProvider(t *testing.T) {
	store := &runtimeSemanticStore{buildStatus: index.IndexStatus{State: index.StateEmpty}}
	runtime := semanticRuntime(t, runtimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		t.Fatal("empty build must not create provider")
		return nil, nil
	})
	status, err := runtime.BuildIndex(context.Background(), "embed-main")
	if err != nil || status.State != index.StateEmpty || store.buildCalls != 1 || store.buildRequest.Provider != nil || store.buildRequest.SnapshotHash == "" {
		t.Fatalf("status=%#v err=%v calls=%d request=%#v", status, err, store.buildCalls, store.buildRequest)
	}
}

type blockingIndexStore struct {
	runtimeSemanticStore
	once    sync.Once
	entered chan struct{}
}

func (store *blockingIndexStore) Build(ctx context.Context, _ index.BuildRequest, _ index.ProgressSink) (index.IndexStatus, error) {
	store.once.Do(func() { close(store.entered) })
	<-ctx.Done()
	return index.IndexStatus{State: index.StateFailed}, ctx.Err()
}

func TestLoadedRuntimeBuildCoordinatorCancelAndClose(t *testing.T) {
	store := &blockingIndexStore{entered: make(chan struct{})}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		return &runtimeQueryEmbedder{}, nil
	})
	done := make(chan error, 1)
	go func() { _, err := runtime.BuildIndex(context.Background(), "embed-main"); done <- err }()
	<-store.entered
	if _, err := runtime.BuildIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexBuildActive) {
		t.Fatalf("duplicate err=%v", err)
	}
	if status, err := runtime.IndexStatus(context.Background(), "embed-main"); err != nil || status.State != index.StateBuilding {
		t.Fatalf("status=%#v err=%v", status, err)
	}
	if _, err := runtime.ClearIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexBuildActive) {
		t.Fatalf("clear err=%v", err)
	}
	if cancelled, err := runtime.CancelIndex(context.Background(), "other"); err != nil || cancelled {
		t.Fatalf("other cancelled=%v err=%v", cancelled, err)
	}
	if cancelled, err := runtime.CancelIndex(context.Background(), "embed-main"); err != nil || !cancelled {
		t.Fatalf("cancelled=%v err=%v", cancelled, err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("build err=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("build did not cancel")
	}
	if cancelled, err := runtime.CancelIndex(context.Background(), "embed-main"); err != nil || cancelled {
		t.Fatalf("repeat cancelled=%v err=%v", cancelled, err)
	}

	store.once = sync.Once{}
	store.entered = make(chan struct{})
	go func() { _, err := runtime.BuildIndex(context.Background(), "embed-main"); done <- err }()
	<-store.entered
	closed := make(chan struct{})
	go func() { _ = runtime.Close(); close(closed) }()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("close build err=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("close did not cancel build")
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("close did not finish")
	}
}

func TestLoadedRuntimeClearExactProfile(t *testing.T) {
	store := &runtimeSemanticStore{clearStatus: index.IndexStatus{State: index.StateEmpty}}
	runtime := semanticRuntime(t, runtimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		t.Fatal("clear must not create provider")
		return nil, nil
	})
	status, err := runtime.ClearIndex(context.Background(), "embed-main")
	if err != nil || status.State != index.StateEmpty {
		t.Fatalf("status=%#v err=%v", status, err)
	}
	if _, err := runtime.ClearIndex(context.Background(), "other"); !errors.Is(err, ErrIndexUnavailable) {
		t.Fatalf("mismatch err=%v", err)
	}
}
