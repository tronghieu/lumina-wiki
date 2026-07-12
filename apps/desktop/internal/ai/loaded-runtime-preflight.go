package ai

import (
	"context"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

const runtimeFinalizationTimeout = 2 * time.Second

func (runtime *loadedRuntime) failPreflight(parent context.Context, request runtimeChatRequest, sink chat.EventSink,
	code string, cause error, store RuntimeHistoryStore, enabled bool) error {
	guard := chat.NewTerminalGuard(sink, chat.GuardLimits{})
	status, terminalCode := history.StatusFailed, code
	if parent == nil || parent.Err() != nil {
		status, terminalCode = history.StatusCancelled, "cancelled"
		if parent != nil && parent.Err() == context.DeadlineExceeded {
			terminalCode = "deadline_exceeded"
		}
	}
	startCtx, cancelStart := context.WithTimeout(context.Background(), runtimeFinalizationTimeout)
	startErr := guard.Start(startCtx, request.RequestID, request.ConversationID,
		chat.SemanticInfo{Status: "unavailable", Warning: "semantic_unavailable"})
	cancelStart()
	if startErr != nil {
		return providers.NewSafeError("stream_start_failed", "Chat request failed.", startErr)
	}
	if request.History.Persist {
		if store == nil {
			historyOpenCtx, cancelHistoryOpen := context.WithTimeout(context.Background(), runtimeFinalizationTimeout)
			store, enabled, _ = runtime.openHistory(historyOpenCtx)
			cancelHistoryOpen()
		}
		if enabled && store != nil {
			now := time.Now().UTC()
			record := history.ConversationRecord{SchemaVersion: history.CurrentSchemaVersion,
				ConversationID: request.ConversationID, AttemptID: request.RequestID, CreatedAt: now, FinishedAt: now,
				Status: status, UserMessage: request.Question, ErrorCode: terminalCode}
			historyCtx, cancelHistory := context.WithTimeout(context.Background(), runtimeFinalizationTimeout)
			_, _ = store.Append(historyCtx, record)
			cancelHistory()
		}
	}
	terminal := chat.Event{Kind: chat.EventFailed, ErrorCode: terminalCode}
	if status == history.StatusCancelled {
		terminal.Kind = chat.EventCancelled
	}
	terminalCtx, cancelTerminal := context.WithTimeout(context.Background(), runtimeFinalizationTimeout)
	finalErr := guard.Finalize(terminalCtx, terminal)
	cancelTerminal()
	if finalErr != nil {
		return providers.NewSafeError("stream_finalize_failed", "Chat request failed.", finalErr)
	}
	return providers.NewSafeError(terminalCode, "Chat request failed.", cause)
}
