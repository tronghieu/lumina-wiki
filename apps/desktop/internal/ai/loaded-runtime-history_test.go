package ai

import (
	"context"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

func TestLoadedRuntimeIncludesOnlyRecentCompletedOriginalHistoryAndPersistsCompletion(t *testing.T) {
	base := time.Unix(100, 0).UTC()
	records := []history.ConversationRecord{
		completedRecord("conversation", "second", "u2", "a2", base.Add(time.Second)),
		{SchemaVersion: history.CurrentSchemaVersion, ConversationID: "conversation", AttemptID: "failed", CreatedAt: base.Add(2 * time.Second), FinishedAt: base.Add(2 * time.Second), Status: history.StatusFailed, UserMessage: "skip", ErrorCode: "failed"},
		completedRecord("conversation", "first", "u1", "a1", base),
		{SchemaVersion: history.CurrentSchemaVersion, ConversationID: "conversation", AttemptID: "retry", RetryOfAttemptID: "first", CreatedAt: base.Add(3 * time.Second), FinishedAt: base.Add(3 * time.Second), Status: history.StatusCompleted, AssistantOutput: "retry skip"},
	}
	store := &runtimeHistorySpy{enabled: true, records: records}
	provider := &runtimeProviderSpy{events: []providers.StreamEvent{{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "done"}}}}
	runtime := newRuntimeForTest(t, runtimeWorkspace(t), &runtimeConfigSpy{config: runtimeConfig("chat-main", "")}, store, provider)
	err := runtime.RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "current",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"}, History: ChatHistoryOptionsDTO{Include: true, Persist: true}}, &runtimeEventCapture{})
	if err != nil {
		t.Fatal(err)
	}
	want := []providers.ChatMessage{{Role: "user", Content: "u1"}, {Role: "assistant", Content: "a1"},
		{Role: "user", Content: "u2"}, {Role: "assistant", Content: "a2"}, {Role: "user", Content: "current"}}
	if len(provider.request.Turns) != len(want) {
		t.Fatalf("turns = %#v", provider.request.Turns)
	}
	for index := range want {
		if provider.request.Turns[index] != want[index] {
			t.Fatalf("turn %d = %#v, want %#v", index, provider.request.Turns[index], want[index])
		}
	}
	if store.loadCalls != 1 || store.appendCalls != 1 || store.appended[0].Status != history.StatusCompleted ||
		store.appended[0].AttemptID != "request" || store.appended[0].UserMessage != "current" {
		t.Fatalf("history calls load=%d append=%#v", store.loadCalls, store.appended)
	}
}

func TestCompletedHistoryTurnsCapsProviderTurns(t *testing.T) {
	records := make([]history.ConversationRecord, history.MaxAttemptsPerConversation)
	for index := range records {
		records[index] = completedRecord("conversation", attemptID(index), "user", "assistant", time.Unix(int64(index+1), 0))
	}
	turns, err := completedHistoryTurns(records, "conversation")
	if err != nil || len(turns) != providers.MaxProviderTurns-1-1 {
		t.Fatalf("bounded turns = %d, %v", len(turns), err)
	}
	if turns[0].Role != "user" || turns[len(turns)-1].Role != "assistant" {
		t.Fatalf("turn pairing lost: %#v %#v", turns[0], turns[len(turns)-1])
	}
}

func attemptID(index int) string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	return "attempt_" + string(alphabet[index/36]) + string(alphabet[index%36])
}
