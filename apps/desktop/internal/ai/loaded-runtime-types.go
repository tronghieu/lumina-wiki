package ai

import (
	"context"
	"os"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

type RootTrustProvider interface {
	TrustedRootIdentity(workspaceid.WorkspaceID, string) (os.FileInfo, error)
}

type ConfigReader interface {
	Load() (settings.Config, error)
}

type CredentialResolver interface {
	Get(context.Context, string) ([]byte, error)
}

type RuntimeHistoryStore interface {
	Enabled(context.Context) (bool, error)
	Load(context.Context, string) ([]history.ConversationRecord, error)
	Append(context.Context, history.ConversationRecord) (history.AppendOutcome, error)
}

type LexicalFactory func(context.Context, string, os.FileInfo) (*retrieval.Lexical, error)
type HistoryFactory func(string, workspaceid.WorkspaceID) (RuntimeHistoryStore, error)
type ProviderFactory func(settings.Profile, providers.SafeClient, CredentialResolver) (providers.ChatProvider, error)
type RetrieverFactory func(*retrieval.Lexical, bool) chat.RetrievalRunner

type LoadedRuntimeDependencies struct {
	Trust            RootTrustProvider
	Config           ConfigReader
	Credentials      CredentialResolver
	Client           providers.SafeClient
	HistoryBase      string
	LexicalFactory   LexicalFactory
	HistoryFactory   HistoryFactory
	ProviderFactory  ProviderFactory
	RetrieverFactory RetrieverFactory
}
