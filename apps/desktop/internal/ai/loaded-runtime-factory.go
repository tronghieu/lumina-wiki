package ai

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

type LoadedRuntimeFactory struct{ deps LoadedRuntimeDependencies }

type loadedRuntime struct {
	mu        sync.Mutex
	wg        sync.WaitGroup
	closeOnce sync.Once
	ctx       context.Context
	cancel    context.CancelFunc
	id        workspaceid.WorkspaceID
	root      string
	proof     os.FileInfo
	deps      LoadedRuntimeDependencies
	citations *chat.CitationLeaseRegistry
	closed    bool
}

func NewLoadedRuntimeFactory(deps LoadedRuntimeDependencies) (*LoadedRuntimeFactory, error) {
	if nilLike(deps.Trust) || nilLike(deps.Config) || nilLike(deps.Credentials) ||
		deps.HistoryBase == "" || !filepath.IsAbs(deps.HistoryBase) {
		return nil, ErrInvalidInput
	}
	deps.HistoryBase = filepath.Clean(deps.HistoryBase)
	if deps.LexicalFactory == nil {
		deps.LexicalFactory = func(ctx context.Context, root string, proof os.FileInfo) (*retrieval.Lexical, error) {
			return retrieval.BuildLexicalTrusted(ctx, nil, root, proof)
		}
	}
	if deps.HistoryFactory == nil {
		deps.HistoryFactory = func(base string, id workspaceid.WorkspaceID) (RuntimeHistoryStore, error) {
			return history.NewHistoryStore(base, id)
		}
	}
	if deps.ProviderFactory == nil {
		deps.ProviderFactory = func(profile settings.Profile, client providers.SafeClient, credentials CredentialResolver) (providers.ChatProvider, error) {
			return providers.NewProvider(profile, client, credentials)
		}
	}
	if deps.RetrieverFactory == nil {
		deps.RetrieverFactory = func(config chat.HybridConfig) chat.RetrievalRunner { return chat.NewHybridRetriever(config) }
	}
	if deps.SemanticStoreFactory == nil {
		deps.SemanticStoreFactory = func(id workspaceid.WorkspaceID) (RuntimeSemanticStore, error) { return index.NewStore(id) }
	}
	if deps.EmbeddingProviderFactory == nil {
		deps.EmbeddingProviderFactory = func(profile settings.Profile, options index.FactoryOptions) (index.EmbeddingProvider, error) {
			return index.NewEmbeddingProvider(profile, options)
		}
	}
	return &LoadedRuntimeFactory{deps: deps}, nil
}

func (factory *LoadedRuntimeFactory) Load(ctx context.Context, id workspaceid.WorkspaceID, root string) (session.Runtime, error) {
	if factory == nil || ctx == nil || ctx.Err() != nil || !id.Valid() || !validRuntimeRoot(root) {
		return nil, ErrRuntimeLoad
	}
	proof, err := factory.deps.Trust.TrustedRootIdentity(id, root)
	if err != nil || nilLike(proof) || !proof.IsDir() {
		return nil, ErrRuntimeLoad
	}
	runtimeCtx, cancel := context.WithCancel(context.Background())
	return &loadedRuntime{ctx: runtimeCtx, cancel: cancel, id: id, root: root, proof: proof,
		deps: factory.deps, citations: chat.NewCitationLeaseRegistry()}, nil
}

func (runtime *loadedRuntime) Close() error {
	if runtime == nil {
		return nil
	}
	runtime.closeOnce.Do(func() {
		runtime.mu.Lock()
		runtime.closed, runtime.root, runtime.proof = true, "", nil
		runtime.cancel()
		runtime.mu.Unlock()
		runtime.wg.Wait()
		runtime.citations.Close()
	})
	return nil
}

func validRuntimeRoot(root string) bool {
	return root != "" && len(root) <= workspaceid.MaxCanonicalPathBytes && utf8.ValidString(root) &&
		!strings.ContainsRune(root, '\x00') && filepath.IsAbs(root) && filepath.Clean(root) == root
}

func nilLike(value any) bool {
	if value == nil {
		return true
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return reflected.IsNil()
	default:
		return false
	}
}

var _ RuntimeFactory = (*LoadedRuntimeFactory)(nil)
var _ session.Runtime = (*loadedRuntime)(nil)
