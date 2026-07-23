package ai

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type atomicRuntimeConfig struct {
	config settings.Config
	calls  atomic.Int32
}

func (reader *atomicRuntimeConfig) Load() (settings.Config, error) {
	reader.calls.Add(1)
	return reader.config, nil
}

func TestLoadedRuntimeConsentGatePreventsTransientConfigVisibility(t *testing.T) {
	root := runtimeWorkspace(t)
	proof, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	gate := NewConsentAccessGate()
	config := &atomicRuntimeConfig{config: runtimeConfig("chat-main", "embed-main")}
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{
		ConsentAccess: gate, Trust: &runtimeTrustSpy{proof: proof}, Config: config,
		Credentials: &runtimeCredentialSpy{}, HistoryBase: t.TempDir(),
		LexicalFactory: func(context.Context, string, os.FileInfo) (*retrieval.Lexical, error) {
			return nil, errors.New("stop after config")
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := factory.Load(context.Background(), testWorkspaceID, root)
	if err != nil {
		t.Fatal(err)
	}
	runtime := loaded.(*loadedRuntime)
	finishMutation, err := gate.BeginMutation(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	withoutEmbedding := semanticRuntimeRequest()
	withoutEmbedding.Profiles.EmbeddingProfileID = ""
	if err := runtime.RunChat(context.Background(), withoutEmbedding, discardEventSink{}); err == nil {
		t.Fatal("chat without embedding unexpectedly succeeded")
	}
	baseline := config.calls.Load()
	if baseline != 1 {
		t.Fatalf("chat without embedding config loads = %d, want 1", baseline)
	}

	type operation func(context.Context) error
	operations := []operation{
		func(ctx context.Context) error {
			return runtime.RunChat(ctx, semanticRuntimeRequest(), discardEventSink{})
		},
		func(ctx context.Context) error { _, err := runtime.BuildIndex(ctx, "embed-main"); return err },
		func(ctx context.Context) error {
			_, err := runtime.EmbeddingConsentSubject(ctx, "embed-main")
			return err
		},
	}
	done := make(chan error, len(operations))
	for _, run := range operations {
		go func(operation operation) { done <- operation(context.Background()) }(run)
	}
	time.Sleep(25 * time.Millisecond)
	if got := config.calls.Load(); got != baseline {
		t.Fatalf("consumers observed transient config: loads=%d, want %d", got, baseline)
	}
	closeDone := make(chan struct{})
	go func() { _ = runtime.Close(); close(closeDone) }()
	for range operations {
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("closed runtime consumer error = %v", err)
		}
	}
	select {
	case <-closeDone:
	case <-time.After(time.Second):
		t.Fatal("runtime close did not release blocked consumers")
	}
	finishMutation()
}

func TestLoadedRuntimeBuildReservesCoordinatorBeforeWaitingForConsent(t *testing.T) {
	gate := NewConsentAccessGate()
	runtime := semanticRuntime(t, runtimeWorkspace(t), &runtimeSemanticStore{
		buildStatus: index.IndexStatus{State: index.StateEmpty},
	}, nil)
	runtime.deps.ConsentAccess = gate
	finishMutation, err := gate.BeginMutation(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	firstDone := make(chan error, 1)
	go func() {
		_, buildErr := runtime.BuildIndex(context.Background(), "embed-main")
		firstDone <- buildErr
	}()
	if !waitForIndexBuildReservation(runtime, time.Second) {
		finishMutation()
		<-firstDone
		t.Fatal("build did not reserve coordinator while waiting for consent")
	}
	if _, err := runtime.BuildIndex(context.Background(), "embed-main"); !errors.Is(err, ErrIndexBuildActive) {
		finishMutation()
		<-firstDone
		t.Fatalf("duplicate build err=%v", err)
	}
	finishMutation()
	if err := <-firstDone; err != nil {
		t.Fatalf("first build err=%v", err)
	}
}

func waitForIndexBuildReservation(runtime *loadedRuntime, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if runtime.indexBuilding("embed-main") {
			return true
		}
		time.Sleep(time.Millisecond)
	}
	return false
}

var _ ConfigReader = (*atomicRuntimeConfig)(nil)
