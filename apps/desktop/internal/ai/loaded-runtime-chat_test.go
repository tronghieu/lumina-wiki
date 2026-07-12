package ai

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func TestLoadedRuntimeRunsTrustedLexicalChatAndPublishesCitation(t *testing.T) {
	root := runtimeWorkspace(t)
	note := filepath.Join(root, "wiki", "note.md")
	if err := os.WriteFile(note, []byte("# Grounded\n\ntrusted needle evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	provider := &runtimeProviderSpy{events: []providers.StreamEvent{
		{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "Grounded [S1]"}},
		{Kind: providers.EventUsage, Usage: &providers.Usage{InputTokens: 3, OutputTokens: 2, TotalTokens: 5}},
	}}
	historyStore := &runtimeHistorySpy{enabled: false}
	runtime := newRuntimeForTest(t, root, &runtimeConfigSpy{config: runtimeConfig("chat-main", "")}, historyStore, provider)
	capture := &runtimeEventCapture{}
	err := runtime.RunChat(context.Background(), runtimeChatRequest{
		RequestID: "request", ConversationID: "conversation", Question: "needle",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"},
	}, capture)
	if err != nil {
		t.Fatal(err)
	}
	if provider.calls != 1 || historyStore.enabledCalls != 1 || historyStore.appendCalls != 0 {
		t.Fatalf("calls provider=%d enabled=%d append=%d", provider.calls, historyStore.enabledCalls, historyStore.appendCalls)
	}
	if len(capture.events) != 5 || capture.events[0].Kind != chat.EventStarted || capture.events[0].Semantic.Status != string(retrieval.SemanticDisabled) ||
		capture.events[1].Kind != chat.EventDelta || capture.events[2].Kind != chat.EventCitation || capture.events[3].Kind != chat.EventUsage || capture.events[4].Kind != chat.EventCompleted {
		t.Fatalf("events = %#v", capture.events)
	}
	citation := capture.events[2].Citation
	noteResult, err := runtime.ReadCitationNote(context.Background(), "request", citation.CitationID)
	if err != nil || noteResult.Content != "# Grounded\n\ntrusted needle evidence" {
		t.Fatalf("citation = %#v, %v", noteResult, err)
	}
}

func TestLoadedRuntimeSelectedEmbeddingIsVisibleUnavailableWithoutEmbeddingCall(t *testing.T) {
	root := runtimeWorkspace(t)
	if err := os.WriteFile(filepath.Join(root, "wiki", "note.md"), []byte("needle evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	provider := &runtimeProviderSpy{events: []providers.StreamEvent{{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "Answer"}}}}
	runtime := newRuntimeForTest(t, root, &runtimeConfigSpy{config: runtimeConfig("chat-main", "embed-main")}, &runtimeHistorySpy{}, provider)
	capture := &runtimeEventCapture{}
	err := runtime.RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "needle",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main", EmbeddingProfileID: "embed-main"}}, capture)
	if err != nil {
		t.Fatal(err)
	}
	started := capture.events[0]
	if started.Semantic.Status != string(retrieval.SemanticUnavailable) || started.Semantic.Warning != retrieval.WarningSemanticUnavailable || provider.calls != 1 {
		t.Fatalf("semantic fallback = %#v provider calls %d", started.Semantic, provider.calls)
	}
}
