package ai

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestLoadedRuntimeSemanticNonReadyStatesFallbackWithoutEmbedding(t *testing.T) {
	for _, test := range []struct {
		state  index.IndexState
		status retrieval.SemanticStatus
	}{
		{index.StateEmpty, retrieval.SemanticEmpty},
		{index.StateStale, retrieval.SemanticStale},
		{index.StateCorrupt, retrieval.SemanticCorrupt},
		{index.StateFailed, retrieval.SemanticUnavailable},
	} {
		t.Run(string(test.state), func(t *testing.T) {
			root := semanticRuntimeWorkspace(t)
			store := &runtimeSemanticStore{status: index.IndexStatus{State: test.state}}
			embedCalls := 0
			runtime := semanticRuntime(t, root, store,
				func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
					embedCalls++
					return &runtimeQueryEmbedder{}, nil
				})
			capture := &runtimeEventCapture{}
			if err := runtime.RunChat(context.Background(), semanticRuntimeRequest(), capture); err != nil {
				t.Fatal(err)
			}
			if capture.events[0].Semantic.Status != string(test.status) || embedCalls != 0 || store.searchCalls != 0 || store.statusCalls != 1 {
				t.Fatalf("semantic=%#v embed=%d store=%#v", capture.events[0].Semantic, embedCalls, store)
			}
		})
	}
}

func TestLoadedRuntimeSemanticEmptyCorpusSkipsStoreAndEmbedding(t *testing.T) {
	root := runtimeWorkspace(t)
	storeCalls, embedCalls := 0, 0
	runtime := semanticRuntimeWithFactories(t, root,
		func(workspaceid.WorkspaceID) (RuntimeSemanticStore, error) {
			storeCalls++
			return &runtimeSemanticStore{}, nil
		},
		func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
			embedCalls++
			return &runtimeQueryEmbedder{}, nil
		})
	capture := &runtimeEventCapture{}
	if err := runtime.RunChat(context.Background(), semanticRuntimeRequest(), capture); err != nil {
		t.Fatal(err)
	}
	if capture.events[0].Semantic.Status != string(retrieval.SemanticEmpty) || storeCalls != 0 || embedCalls != 0 {
		t.Fatalf("semantic=%#v store=%d embed=%d", capture.events[0].Semantic, storeCalls, embedCalls)
	}
}

func TestLoadedRuntimeSemanticReadyQueriesAndSearchesWithExactMetadata(t *testing.T) {
	root := semanticRuntimeWorkspace(t)
	proof, _ := os.Stat(root)
	lexical, err := retrieval.BuildLexicalTrusted(context.Background(), nil, root, proof)
	if err != nil {
		t.Fatal(err)
	}
	chunks, err := lexical.Chunks(context.Background())
	if err != nil || len(chunks) != 1 {
		t.Fatalf("chunks=%#v err=%v", chunks, err)
	}
	store := &runtimeSemanticStore{status: index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8},
		hits: []retrieval.SemanticHit{{ChunkID: chunks[0].ID, Score: .9, Rank: 1}}}
	embedder := &runtimeQueryEmbedder{batch: index.EmbeddingBatch{Model: "model", Dimensions: 8, Vectors: [][]float32{{1, 0, 0, 0, 0, 0, 0, 0}}}}
	runtime := semanticRuntime(t, root, store,
		func(_ settings.Profile, options index.FactoryOptions) (index.EmbeddingProvider, error) {
			if options.WorkspaceID != "ws_11111111111111111111111111111111" || options.Config.Embedding == nil {
				t.Fatalf("embedding options = %#v", options)
			}
			return embedder, nil
		})
	capture := &runtimeEventCapture{}
	if err := runtime.RunChat(context.Background(), semanticRuntimeRequest(), capture); err != nil {
		t.Fatal(err)
	}
	if capture.events[0].Semantic.Status != string(retrieval.SemanticReady) || embedder.request.Purpose != index.PurposeQuery ||
		store.searchCalls != 1 || store.searchRequest.SnapshotHash != chunks[0].SnapshotHash ||
		store.searchRequest.ChunkerVersion != retrieval.ChunkVersion || store.searchRequest.Dimensions != 8 {
		t.Fatalf("semantic=%#v embed=%#v search=%#v", capture.events[0].Semantic, embedder.request, store.searchRequest)
	}
}

type runtimeSemanticStore struct {
	status        index.IndexStatus
	statusErr     error
	statusCalls   int
	statusRequest index.StatusRequest
	hits          []retrieval.SemanticHit
	searchCalls   int
	searchRequest index.SemanticSearchRequest
}

func (store *runtimeSemanticStore) Status(_ context.Context, request index.StatusRequest) (index.IndexStatus, error) {
	store.statusCalls++
	store.statusRequest = request
	return store.status, store.statusErr
}

func (store *runtimeSemanticStore) Search(_ context.Context, request index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
	store.searchCalls++
	store.searchRequest = request
	return store.hits, nil
}

type runtimeQueryEmbedder struct {
	request index.EmbeddingRequest
	batch   index.EmbeddingBatch
	err     error
}

func (embedder *runtimeQueryEmbedder) Embed(_ context.Context, request index.EmbeddingRequest) (index.EmbeddingBatch, error) {
	embedder.request = request
	return embedder.batch, embedder.err
}

func semanticRuntimeWorkspace(t *testing.T) string {
	root := runtimeWorkspace(t)
	if err := os.WriteFile(filepath.Join(root, "wiki", "note.md"), []byte("needle evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

func semanticRuntime(t *testing.T, root string, store RuntimeSemanticStore, embedding EmbeddingProviderFactory) *loadedRuntime {
	t.Helper()
	return semanticRuntimeWithFactories(t, root,
		func(workspaceid.WorkspaceID) (RuntimeSemanticStore, error) { return store, nil }, embedding)
}

func semanticRuntimeWithFactories(t *testing.T, root string, store SemanticStoreFactory, embedding EmbeddingProviderFactory) *loadedRuntime {
	t.Helper()
	proof, _ := os.Stat(root)
	provider := &runtimeProviderSpy{events: []providers.StreamEvent{{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "done"}}}}
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{
		Trust: &runtimeTrustSpy{proof: proof}, Config: &runtimeConfigSpy{config: runtimeConfig("chat-main", "embed-main")},
		Credentials: &runtimeCredentialSpy{}, HistoryBase: t.TempDir(),
		HistoryFactory: func(string, workspaceid.WorkspaceID) (RuntimeHistoryStore, error) { return &runtimeHistorySpy{}, nil },
		ProviderFactory: func(settings.Profile, providers.SafeClient, CredentialResolver) (providers.ChatProvider, error) {
			return provider, nil
		},
		SemanticStoreFactory: store, EmbeddingProviderFactory: embedding,
	})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := factory.Load(context.Background(), "ws_11111111111111111111111111111111", root)
	if err != nil {
		t.Fatal(err)
	}
	return loaded.(*loadedRuntime)
}

func semanticRuntimeRequest() runtimeChatRequest {
	return runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "needle",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main", EmbeddingProfileID: "embed-main"}}
}
