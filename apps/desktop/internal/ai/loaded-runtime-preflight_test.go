package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestLoadedRuntimeProfilePreflightEmitsStartedFailedAndPersistsOnce(t *testing.T) {
	root := runtimeWorkspace(t)
	store := &runtimeHistorySpy{enabled: true}
	provider := &runtimeProviderSpy{}
	runtime := newRuntimeForTest(t, root, &runtimeConfigSpy{config: runtimeConfig("saved-profile", "")}, store, provider)
	capture := &runtimeEventCapture{}
	err := runtime.RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "private question",
		Profiles: ProfileSelectionDTO{ChatProfileID: "requested-profile"}, History: ChatHistoryOptionsDTO{Persist: true}}, capture)
	if err == nil || strings.Contains(err.Error(), root) || strings.Contains(err.Error(), "private question") {
		t.Fatalf("unsafe preflight error: %v", err)
	}
	if len(capture.events) != 2 || capture.events[0].Kind != chat.EventStarted || capture.events[1].Kind != chat.EventFailed ||
		capture.events[1].ErrorCode != "chat_profile_unavailable" {
		t.Fatalf("events = %#v", capture.events)
	}
	if store.appendCalls != 1 || len(store.appended) != 1 || store.appended[0].Status != history.StatusFailed ||
		store.appended[0].AttemptID != "request" || store.appended[0].ErrorCode != "chat_profile_unavailable" || provider.calls != 0 {
		t.Fatalf("preflight history=%#v provider=%d", store.appended, provider.calls)
	}
}

func TestLoadedRuntimeHistoryDisabledOrCorruptNeverCallsProvider(t *testing.T) {
	for _, test := range []struct {
		name    string
		store   *runtimeHistorySpy
		history ChatHistoryOptionsDTO
		code    string
	}{
		{"disabled persist", &runtimeHistorySpy{enabled: false}, ChatHistoryOptionsDTO{Persist: true}, "history_disabled"},
		{"corrupt include", &runtimeHistorySpy{enabled: true, loadErr: errors.New("private corrupt detail")}, ChatHistoryOptionsDTO{Include: true}, "history_unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := &runtimeProviderSpy{}
			runtime := newRuntimeForTest(t, runtimeWorkspace(t), &runtimeConfigSpy{config: runtimeConfig("chat-main", "")}, test.store, provider)
			capture := &runtimeEventCapture{}
			err := runtime.RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "question",
				Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"}, History: test.history}, capture)
			if err == nil || strings.Contains(err.Error(), "private corrupt detail") || len(capture.events) != 2 ||
				capture.events[1].ErrorCode != test.code || provider.calls != 0 || test.store.appendCalls != 0 {
				t.Fatalf("result err=%v events=%#v provider=%d append=%d", err, capture.events, provider.calls, test.store.appendCalls)
			}
		})
	}
}

func TestLoadedRuntimeRejectsRootReplacementBeforeProviderStream(t *testing.T) {
	root := runtimeWorkspace(t)
	if err := os.WriteFile(filepath.Join(root, "wiki", "note.md"), []byte("old evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	provider := &runtimeProviderSpy{}
	runtime := newRuntimeForTest(t, root, &runtimeConfigSpy{config: runtimeConfig("chat-main", "")}, &runtimeHistorySpy{}, provider)
	if err := os.Rename(root, root+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(root, "README.md"), []byte("# replacement"), 0o600)
	capture := &runtimeEventCapture{}
	err := runtime.RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "question",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"}}, capture)
	if err == nil || len(capture.events) != 2 || capture.events[1].ErrorCode != "retrieval_unavailable" || provider.calls != 0 {
		t.Fatalf("replacement result err=%v events=%#v calls=%d", err, capture.events, provider.calls)
	}
}

func TestLoadedRuntimeRejectsRootReplacementBeforeProviderFactoryOrCredential(t *testing.T) {
	root := runtimeWorkspace(t)
	proof, _ := os.Stat(root)
	credentials := &runtimeCredentialSpy{}
	provider := &runtimeProviderSpy{}
	factoryCalls := 0
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{
		Trust: &runtimeTrustSpy{proof: proof}, Config: &runtimeConfigSpy{config: runtimeConfig("chat-main", "")},
		Credentials: credentials, HistoryBase: t.TempDir(),
		HistoryFactory: func(string, workspaceid.WorkspaceID) (RuntimeHistoryStore, error) { return &runtimeHistorySpy{}, nil },
		ProviderFactory: func(settings.Profile, providers.SafeClient, CredentialResolver) (providers.ChatProvider, error) {
			factoryCalls++
			return provider, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := factory.Load(context.Background(), "ws_11111111111111111111111111111111", root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(root, root+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(root, "README.md"), []byte("# replacement"), 0o600)
	capture := &runtimeEventCapture{}
	err = loaded.(*loadedRuntime).RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "question",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"}}, capture)
	if err == nil || factoryCalls != 0 || credentials.calls != 0 || provider.calls != 0 || len(capture.events) != 2 ||
		capture.events[1].ErrorCode != "retrieval_unavailable" {
		t.Fatalf("result err=%v factory=%d credential=%d stream=%d events=%#v", err, factoryCalls, credentials.calls, provider.calls, capture.events)
	}
}

var _ providers.ChatProvider = (*runtimeProviderSpy)(nil)
