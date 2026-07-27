package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type blockingClearIndexStore struct {
	runtimeSemanticStore
	entered chan struct{}
	release chan struct{}
}

type releasableBuildIndexStore struct {
	runtimeSemanticStore
	entered chan struct{}
	release chan struct{}
}

func (store *releasableBuildIndexStore) Build(ctx context.Context, _ index.BuildRequest, _ index.ProgressSink) (index.IndexStatus, error) {
	close(store.entered)
	select {
	case <-store.release:
		return index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8}, nil
	case <-ctx.Done():
		return index.IndexStatus{State: index.StateFailed}, ctx.Err()
	}
}

func (store *blockingClearIndexStore) Clear(ctx context.Context) (index.IndexStatus, error) {
	close(store.entered)
	select {
	case <-store.release:
		return index.IndexStatus{State: index.StateEmpty}, nil
	case <-ctx.Done():
		return index.IndexStatus{State: index.StateFailed}, ctx.Err()
	}
}

func TestLoadedRuntimeClearReservationRejectsBuild(t *testing.T) {
	store := &blockingClearIndexStore{entered: make(chan struct{}), release: make(chan struct{})}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		return &runtimeQueryEmbedder{}, nil
	})
	clearDone := make(chan struct {
		status index.IndexStatus
		err    error
	}, 1)
	go func() {
		status, err := runtime.ClearIndex(context.Background(), "embed-main")
		clearDone <- struct {
			status index.IndexStatus
			err    error
		}{status, err}
	}()
	<-store.entered
	if _, err := runtime.BuildIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexBuildActive) {
		t.Fatalf("build during clear err=%v", err)
	}
	close(store.release)
	result := <-clearDone
	if result.err != nil || result.status.State != index.StateEmpty {
		t.Fatalf("clear status=%#v err=%v", result.status, result.err)
	}
}

func TestLoadedRuntimeBuildReservationRejectsClearAcrossProfileTransition(t *testing.T) {
	store := &releasableBuildIndexStore{entered: make(chan struct{}), release: make(chan struct{})}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		return &runtimeQueryEmbedder{}, nil
	})
	done := make(chan struct {
		status index.IndexStatus
		err    error
	}, 1)
	go func() {
		status, err := runtime.BuildIndex(context.Background(), "embed-main")
		done <- struct {
			status index.IndexStatus
			err    error
		}{status, err}
	}()
	<-store.entered
	runtime.deps.Config.(*runtimeConfigSpy).config = runtimeConfig("chat-main", "embed-next")
	if _, err := runtime.ClearIndex(context.Background(), "embed-next"); !errors.Is(err, ErrIndexBuildActive) {
		t.Fatalf("cross-profile clear err=%v", err)
	}
	close(store.release)
	result := <-done
	if result.err != nil || result.status.State != index.StateReady {
		t.Fatalf("authoritative build=%#v err=%v", result.status, result.err)
	}
}

func TestLoadedRuntimeClearReservationCancelAndErrorRelease(t *testing.T) {
	store := &blockingClearIndexStore{entered: make(chan struct{}), release: make(chan struct{})}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		return &runtimeQueryEmbedder{}, nil
	})
	done := make(chan error, 1)
	go func() { _, err := runtime.ClearIndex(context.Background(), "embed-main"); done <- err }()
	<-store.entered
	if cancelled, err := runtime.CancelIndex(context.Background(), "embed-main"); err != nil || cancelled {
		t.Fatalf("clear cancelled=%v err=%v", cancelled, err)
	}
	select {
	case err := <-done:
		t.Fatalf("cancel stopped clear: %v", err)
	default:
	}
	close(store.release)
	if err := <-done; err != nil {
		t.Fatalf("clear err=%v", err)
	}

	failing := &runtimeSemanticStore{clearStatus: index.IndexStatus{State: index.StateFailed}, clearErr: errors.New("clear failed")}
	runtime = semanticRuntime(t, runtimeWorkspace(t), failing, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		t.Fatal("clear must not create provider")
		return nil, nil
	})
	if _, err := runtime.ClearIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexUnavailable) {
		t.Fatalf("first clear err=%v", err)
	}
	failing.clearErr, failing.clearStatus = nil, index.IndexStatus{State: index.StateEmpty}
	if status, err := runtime.ClearIndex(context.Background(), "embed-main"); err != nil || status.State != index.StateEmpty {
		t.Fatalf("released clear status=%#v err=%v", status, err)
	}
}

func TestLoadedRuntimeCloseCancelsClearWithoutStaleReservation(t *testing.T) {
	store := &blockingClearIndexStore{entered: make(chan struct{}), release: make(chan struct{})}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store, func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
		return &runtimeQueryEmbedder{}, nil
	})
	clearDone := make(chan error, 1)
	go func() { _, err := runtime.ClearIndex(context.Background(), "embed-main"); clearDone <- err }()
	<-store.entered
	closed := make(chan struct{})
	go func() { _ = runtime.Close(); close(closed) }()
	if err := <-clearDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("clear err=%v", err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("close did not finish")
	}
	runtime.indexMu.Lock()
	mutation := runtime.indexMutation
	runtime.indexMu.Unlock()
	if mutation != nil {
		t.Fatalf("stale reservation=%#v", mutation)
	}
}

func TestLoadedRuntimeMutationCoordinatorAdmitsOneOfBuildOrClear(t *testing.T) {
	runtime := &loadedRuntime{}
	for iteration := 0; iteration < 100; iteration++ {
		start := make(chan struct{})
		type outcome struct {
			done func()
			err  error
		}
		results := make(chan outcome, 2)
		go func() {
			<-start
			_, done, err := runtime.startIndexBuild(context.Background(), "embed-main")
			results <- outcome{done, err}
		}()
		go func() { <-start; done, err := runtime.startIndexClear(); results <- outcome{done, err} }()
		close(start)
		first, second := <-results, <-results
		admitted := 0
		for _, result := range []outcome{first, second} {
			if result.err == nil {
				admitted++
				result.done()
			} else if !errors.Is(result.err, ErrIndexBuildActive) {
				t.Fatalf("iteration %d err=%v", iteration, result.err)
			}
		}
		if admitted != 1 {
			t.Fatalf("iteration %d admitted=%d", iteration, admitted)
		}
	}
}
