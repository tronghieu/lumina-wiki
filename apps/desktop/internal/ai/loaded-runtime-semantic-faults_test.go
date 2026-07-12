package ai

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestLoadedRuntimeSemanticStatusErrorAndDimensionMismatchNeverEmbed(t *testing.T) {
	for _, test := range []struct {
		name   string
		store  *runtimeSemanticStore
		status retrieval.SemanticStatus
	}{
		{"offline", &runtimeSemanticStore{statusErr: errors.New("private offline detail")}, retrieval.SemanticUnavailable},
		{"dimension mismatch", &runtimeSemanticStore{status: index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 7}}, retrieval.SemanticCorrupt},
	} {
		t.Run(test.name, func(t *testing.T) {
			embedCalls := 0
			runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), test.store,
				func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
					embedCalls++
					return &runtimeQueryEmbedder{}, nil
				})
			capture := &runtimeEventCapture{}
			if err := runtime.RunChat(context.Background(), semanticRuntimeRequest(), capture); err != nil {
				t.Fatal(err)
			}
			if capture.events[0].Semantic.Status != string(test.status) || embedCalls != 0 || test.store.searchCalls != 0 ||
				strings.Contains(eventText(capture.events), "private offline detail") {
				t.Fatalf("semantic=%#v embed=%d store=%#v", capture.events[0].Semantic, embedCalls, test.store)
			}
		})
	}
}

func TestLoadedRuntimeMissingEmbeddingConsentFallsBackWithoutCredentialOrSearch(t *testing.T) {
	root := semanticRuntimeWorkspace(t)
	proof, _ := os.Stat(root)
	credentials := &runtimeCredentialSpy{}
	store := &runtimeSemanticStore{status: index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: 8}}
	chatProvider := &runtimeProviderSpy{events: []providers.StreamEvent{{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "done"}}}}
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{
		Trust: &runtimeTrustSpy{proof: proof}, Config: &runtimeConfigSpy{config: runtimeConfig("chat-main", "embed-main")},
		Credentials: credentials, HistoryBase: t.TempDir(),
		HistoryFactory: func(string, workspaceid.WorkspaceID) (RuntimeHistoryStore, error) { return &runtimeHistorySpy{}, nil },
		ProviderFactory: func(settings.Profile, providers.SafeClient, CredentialResolver) (providers.ChatProvider, error) {
			return chatProvider, nil
		},
		SemanticStoreFactory: func(workspaceid.WorkspaceID) (RuntimeSemanticStore, error) { return store, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	loaded, _ := factory.Load(context.Background(), "ws_11111111111111111111111111111111", root)
	capture := &runtimeEventCapture{}
	if err := loaded.(*loadedRuntime).RunChat(context.Background(), semanticRuntimeRequest(), capture); err != nil {
		t.Fatal(err)
	}
	if capture.events[0].Semantic.Status != string(retrieval.SemanticUnavailable) ||
		capture.events[0].Semantic.Warning != retrieval.WarningSemanticUnavailable || credentials.calls != 0 || store.searchCalls != 0 ||
		capture.events[len(capture.events)-1].Kind != chat.EventCompleted {
		t.Fatalf("events=%#v credential=%d search=%d", capture.events, credentials.calls, store.searchCalls)
	}
}

func TestLoadedRuntimeDynamicDimensionsRejectOversizedReadyStatusBeforeEmbeddingFactory(t *testing.T) {
	root := semanticRuntimeWorkspace(t)
	proof, _ := os.Stat(root)
	config := runtimeConfig("chat-main", "embed-main")
	config.Embedding.Dimensions = 0
	store := &runtimeSemanticStore{status: index.IndexStatus{State: index.StateReady, Chunks: 1, Vectors: 1, Dimensions: index.MaxVectorDimensions + 1}}
	factoryCalls := 0
	chatProvider := &runtimeProviderSpy{events: []providers.StreamEvent{{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "done"}}}}
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{
		Trust: &runtimeTrustSpy{proof: proof}, Config: &runtimeConfigSpy{config: config}, Credentials: &runtimeCredentialSpy{}, HistoryBase: t.TempDir(),
		HistoryFactory: func(string, workspaceid.WorkspaceID) (RuntimeHistoryStore, error) { return &runtimeHistorySpy{}, nil },
		ProviderFactory: func(settings.Profile, providers.SafeClient, CredentialResolver) (providers.ChatProvider, error) {
			return chatProvider, nil
		},
		SemanticStoreFactory: func(workspaceid.WorkspaceID) (RuntimeSemanticStore, error) { return store, nil },
		EmbeddingProviderFactory: func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
			factoryCalls++
			return &runtimeQueryEmbedder{}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	loaded, _ := factory.Load(context.Background(), "ws_11111111111111111111111111111111", root)
	capture := &runtimeEventCapture{}
	if err := loaded.(*loadedRuntime).RunChat(context.Background(), semanticRuntimeRequest(), capture); err != nil {
		t.Fatal(err)
	}
	if capture.events[0].Semantic.Status != string(retrieval.SemanticCorrupt) || factoryCalls != 0 || store.searchCalls != 0 {
		t.Fatalf("semantic=%#v factory=%d search=%d", capture.events[0].Semantic, factoryCalls, store.searchCalls)
	}
}

func TestLoadedRuntimeCloseCancelsSemanticStatus(t *testing.T) {
	store := &blockingRuntimeSemanticStore{entered: make(chan struct{})}
	runtime := semanticRuntime(t, semanticRuntimeWorkspace(t), store,
		func(settings.Profile, index.FactoryOptions) (index.EmbeddingProvider, error) {
			return &runtimeQueryEmbedder{}, nil
		})
	capture := &runtimeEventCapture{}
	done := make(chan error, 1)
	go func() { done <- runtime.RunChat(context.Background(), semanticRuntimeRequest(), capture) }()
	select {
	case <-store.entered:
	case <-time.After(time.Second):
		t.Fatal("semantic status did not start")
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil || len(capture.events) != 2 || capture.events[1].Kind != chat.EventCancelled {
		t.Fatalf("close result err=%v events=%#v", err, capture.events)
	}
}

type blockingRuntimeSemanticStore struct{ entered chan struct{} }

func (store *blockingRuntimeSemanticStore) Status(ctx context.Context, _ index.StatusRequest) (index.IndexStatus, error) {
	close(store.entered)
	<-ctx.Done()
	return index.IndexStatus{}, ctx.Err()
}

func (*blockingRuntimeSemanticStore) Search(context.Context, index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
	return nil, errors.New("search must not run")
}
