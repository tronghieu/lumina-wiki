package index

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestProgressCanCallStatusAndClearWithoutDeadlock(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	seedProvider := &recordingEmbedder{dims: 3}
	if _, err := store.Build(context.Background(), requestFor(seedProvider, buildChunk("0", "seed", strings.Repeat("b", 64))), nil); err != nil {
		t.Fatal(err)
	}
	request := requestFor(&recordingEmbedder{dims: 3}, buildChunk("1", "private", strings.Repeat("b", 64)))
	cleared := false
	_, err := store.Build(context.Background(), request, func(_ context.Context, update Progress) error {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		if _, err := store.Status(ctx, StatusRequest{}); err != nil {
			return err
		}
		if !cleared {
			cleared = true
			_, err := store.Clear(ctx)
			return err
		}
		return nil
	})
	if !errors.Is(err, ErrIndexConflict) {
		t.Fatalf("outer build: %v", err)
	}
	if status, _ := store.Status(context.Background(), StatusRequest{}); status.State != StateEmpty {
		t.Fatalf("clear lost: %#v", status)
	}
}

type blockingEmbedder struct {
	entered chan struct{}
	release chan struct{}
}

type reentrantBuildProvider struct {
	store *Store
	run   bool
}

func (p *reentrantBuildProvider) Embed(_ context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	if !p.run {
		p.run = true
		inner := requestFor(&recordingEmbedder{dims: 3}, buildChunk("9", "inner", strings.Repeat("b", 64)))
		if _, err := p.store.Build(context.Background(), inner, nil); err != nil {
			return EmbeddingBatch{}, err
		}
	}
	vectors := make([][]float32, len(request.Inputs))
	for i := range vectors {
		vectors[i] = []float32{1, 2, 3}
	}
	return EmbeddingBatch{Model: "model", Dimensions: 3, Vectors: vectors}, nil
}

func TestProviderCanRunReentrantBuildAndOuterConflicts(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	provider := &reentrantBuildProvider{store: store}
	outer := requestFor(provider, buildChunk("1", "outer", strings.Repeat("b", 64)))
	if _, err := store.Build(context.Background(), outer, nil); !errors.Is(err, ErrIndexConflict) {
		t.Fatalf("outer: %v", err)
	}
	status, err := store.Status(context.Background(), StatusRequest{})
	if err != nil || status.State != StateReady {
		t.Fatalf("inner missing: %#v %v", status, err)
	}
}

func (p *blockingEmbedder) Embed(ctx context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	close(p.entered)
	select {
	case <-ctx.Done():
		return EmbeddingBatch{}, ctx.Err()
	case <-p.release:
	}
	vectors := make([][]float32, len(request.Inputs))
	for i := range vectors {
		vectors[i] = []float32{1, 2, 3}
	}
	return EmbeddingBatch{Model: "model", Dimensions: 3, Vectors: vectors}, nil
}

func TestBlockedProviderDoesNotBlockStatusOrClear(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	if _, err := store.Build(context.Background(), requestFor(&recordingEmbedder{dims: 3}, buildChunk("0", "seed", strings.Repeat("b", 64))), nil); err != nil {
		t.Fatal(err)
	}
	provider := &blockingEmbedder{entered: make(chan struct{}), release: make(chan struct{})}
	done := make(chan error, 1)
	go func() {
		_, err := store.Build(context.Background(), requestFor(provider, buildChunk("1", "private", strings.Repeat("b", 64))), nil)
		done <- err
	}()
	<-provider.entered
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if _, err := store.Status(ctx, StatusRequest{}); err != nil {
		t.Fatalf("status blocked: %v", err)
	}
	if _, err := store.Clear(ctx); err != nil {
		t.Fatalf("clear blocked: %v", err)
	}
	close(provider.release)
	if err := <-done; !errors.Is(err, ErrIndexConflict) {
		t.Fatalf("build conflict: %v", err)
	}
}

func TestBlockedProgressSinkDoesNotBlockStatusOrClear(t *testing.T) {
	store := readyStore(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	done := make(chan error, 1)
	request := requestFor(&recordingEmbedder{dims: 3}, buildChunk("2", "changed", strings.Repeat("b", 64)))
	go func() {
		_, err := store.Build(context.Background(), request, func(context.Context, Progress) error { once.Do(func() { close(entered); <-release }); return nil })
		done <- err
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if _, err := store.Status(ctx, StatusRequest{}); err != nil {
		t.Fatalf("status blocked: %v", err)
	}
	if _, err := store.Clear(ctx); err != nil {
		t.Fatalf("clear blocked: %v", err)
	}
	close(release)
	if err := <-done; !errors.Is(err, ErrIndexConflict) {
		t.Fatalf("outer: %v", err)
	}
}

type secretErrorProvider struct{}

func (secretErrorProvider) Embed(context.Context, EmbeddingRequest) (EmbeddingBatch, error) {
	return EmbeddingBatch{}, errors.New("secret-note https://credential.example Bearer abc provider-body")
}

func TestProviderErrorIsSanitizedWithoutCause(t *testing.T) {
	store, _ := newTestStore(t.TempDir(), testWorkspace)
	_, err := store.Build(context.Background(), requestFor(secretErrorProvider{}, buildChunk("1", "secret-note", strings.Repeat("b", 64))), nil)
	if !errors.Is(err, ErrEmbeddingFailed) {
		t.Fatalf("sentinel missing: %v", err)
	}
	for _, secret := range []string{"secret-note", "credential.example", "Bearer", "provider-body"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("error leaked %q: %v", secret, err)
		}
	}
	if errors.Unwrap(err) != nil {
		t.Fatalf("provider cause retained: %v", errors.Unwrap(err))
	}
}
