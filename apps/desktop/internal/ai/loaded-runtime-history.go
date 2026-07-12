package ai

import (
	"context"
	"errors"
	"sort"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

func (runtime *loadedRuntime) openHistory(ctx context.Context) (RuntimeHistoryStore, bool, error) {
	store, err := runtime.deps.HistoryFactory(runtime.deps.HistoryBase, runtime.id)
	if err != nil || nilLike(store) {
		return nil, false, errors.New("history unavailable")
	}
	enabled, err := store.Enabled(ctx)
	if err != nil {
		return nil, false, err
	}
	return store, enabled, nil
}

func completedHistoryTurns(source []history.ConversationRecord, conversationID string) ([]chat.Turn, error) {
	if len(source) > history.MaxAttemptsPerConversation {
		return nil, errors.New("history exceeds bounds")
	}
	records := append([]history.ConversationRecord(nil), source...)
	sort.Slice(records, func(i, j int) bool {
		if records[i].CreatedAt.Equal(records[j].CreatedAt) {
			return records[i].AttemptID < records[j].AttemptID
		}
		return records[i].CreatedAt.Before(records[j].CreatedAt)
	})
	completed := make([]history.ConversationRecord, 0, len(records))
	for _, record := range records {
		if record.Validate() != nil || record.ConversationID != conversationID {
			return nil, errors.New("history unavailable")
		}
		if record.RetryOfAttemptID == "" && record.Status == history.StatusCompleted && record.AssistantOutput != "" {
			completed = append(completed, record)
		}
	}
	maxRecords := (providers.MaxProviderTurns - 1) / 2
	if len(completed) > maxRecords {
		completed = completed[len(completed)-maxRecords:]
	}
	turns := make([]chat.Turn, 0, len(completed)*2)
	for _, record := range completed {
		turns = append(turns, chat.Turn{Role: "user", Content: record.UserMessage}, chat.Turn{Role: "assistant", Content: record.AssistantOutput})
	}
	return turns, nil
}
