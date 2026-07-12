package ai

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

type runtimeHistorySpy struct {
	mu                             sync.Mutex
	enabled                        bool
	enabledErr, loadErr, appendErr error
	records                        []history.ConversationRecord
	appended                       []history.ConversationRecord
	enabledCalls, loadCalls        int
	appendCalls                    int
}

func (spy *runtimeHistorySpy) Enabled(context.Context) (bool, error) {
	spy.mu.Lock()
	defer spy.mu.Unlock()
	spy.enabledCalls++
	return spy.enabled, spy.enabledErr
}

func (spy *runtimeHistorySpy) Load(context.Context, string) ([]history.ConversationRecord, error) {
	spy.mu.Lock()
	defer spy.mu.Unlock()
	spy.loadCalls++
	return append([]history.ConversationRecord(nil), spy.records...), spy.loadErr
}

func (spy *runtimeHistorySpy) Append(_ context.Context, record history.ConversationRecord) (history.AppendOutcome, error) {
	spy.mu.Lock()
	defer spy.mu.Unlock()
	spy.appendCalls++
	spy.appended = append(spy.appended, record)
	return history.AppendStored, spy.appendErr
}

type runtimeProviderSpy struct {
	mu      sync.Mutex
	calls   int
	request providers.ChatRequest
	events  []providers.StreamEvent
	err     error
}

func (spy *runtimeProviderSpy) Stream(ctx context.Context, request providers.ChatRequest, sink providers.StreamSink) error {
	spy.mu.Lock()
	spy.calls++
	spy.request = request
	events, streamErr := append([]providers.StreamEvent(nil), spy.events...), spy.err
	spy.mu.Unlock()
	for _, event := range events {
		if err := sink.OnEvent(ctx, event); err != nil {
			return err
		}
	}
	return streamErr
}

type runtimeEventCapture struct {
	mu     sync.Mutex
	events []chat.Event
}

func (capture *runtimeEventCapture) OnEvent(_ context.Context, event chat.Event) error {
	capture.mu.Lock()
	defer capture.mu.Unlock()
	capture.events = append(capture.events, event)
	return nil
}

func runtimeProfile(id string, role settings.ProfileRole) settings.Profile {
	kind := settings.ProviderOpenAICompatible
	dimensions := 0
	if role == settings.RoleEmbedding {
		dimensions = 8
	}
	return settings.Profile{SchemaVersion: settings.CurrentProfileSchemaVersion, ID: id, Role: role, Kind: kind,
		Label: "Test", Model: "model", BaseURL: "https://api.example.com/v1", TimeoutMS: 1000,
		MaxInputChars: 10000, MaxHistoryChars: 10000, MaxEvidenceChars: 10000, MaxOutputTokens: 1000, Dimensions: dimensions}
}

func runtimeConfig(chatID, embeddingID string) settings.Config {
	config := settings.DefaultConfig()
	chatProfile := runtimeProfile(chatID, settings.RoleChat)
	config.Chat = &chatProfile
	if embeddingID != "" {
		embedding := runtimeProfile(embeddingID, settings.RoleEmbedding)
		config.Embedding = &embedding
	}
	return config
}

func newRuntimeForTest(t *testing.T, root string, config *runtimeConfigSpy, historyStore RuntimeHistoryStore, provider providers.ChatProvider) *loadedRuntime {
	t.Helper()
	proof, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{
		Trust: &runtimeTrustSpy{proof: proof}, Config: config, Credentials: &runtimeCredentialSpy{}, HistoryBase: t.TempDir(),
		HistoryFactory: func(string, workspaceid.WorkspaceID) (RuntimeHistoryStore, error) { return historyStore, nil },
		ProviderFactory: func(settings.Profile, providers.SafeClient, CredentialResolver) (providers.ChatProvider, error) {
			return provider, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := factory.Load(context.Background(), "ws_11111111111111111111111111111111", filepath.Clean(root))
	if err != nil {
		t.Fatal(err)
	}
	return loaded.(*loadedRuntime)
}

func completedRecord(conversation, attempt, user, assistant string, created time.Time) history.ConversationRecord {
	return history.ConversationRecord{SchemaVersion: history.CurrentSchemaVersion, ConversationID: conversation, AttemptID: attempt,
		CreatedAt: created, FinishedAt: created, Status: history.StatusCompleted, UserMessage: user, AssistantOutput: assistant}
}
