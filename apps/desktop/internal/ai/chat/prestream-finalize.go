package chat

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

func (orchestrator *Orchestrator) finalizationContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), orchestrator.config.FinalizationTimeout)
}

func (orchestrator *Orchestrator) finalizeEarly(parent, current context.Context, request Request, sink EventSink, code string, cause error) error {
	guard := NewTerminalGuard(sink, orchestrator.config.GuardLimits)
	return orchestrator.finalizeWithGuard(parent, current, request, guard, false, code, cause)
}

func (orchestrator *Orchestrator) finalizeWithGuard(parent, current context.Context, request Request, guard *TerminalGuard, started bool, code string, cause error) error {
	status, code := prestreamOutcome(parent, current, cause, code)
	if !started {
		startCtx, startCancel := orchestrator.finalizationContext()
		if err := guard.Start(startCtx, request.RequestID, request.ConversationID, SemanticInfo{Status: "unavailable", Warning: "semantic_unavailable"}); err != nil && status != history.StatusCancelled {
			status, code, cause = history.StatusFailed, "stream_start_failed", err
		}
		startCancel()
	}
	created := orchestrator.config.Clock().UTC()
	record := buildHistoryRecord(request, created, created, status, code, "", nil, nil)
	if request.HistoryEnabled {
		historyCtx, historyCancel := orchestrator.finalizationContext()
		outcome, err := orchestrator.config.History.Append(historyCtx, record)
		if status != history.StatusCancelled {
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(historyCtx.Err(), context.DeadlineExceeded) {
				status, code = history.StatusFailed, "history_write_timeout"
			} else if err != nil || outcome != history.AppendStored && outcome != history.AppendIdempotent {
				status, code = history.StatusFailed, "history_write_failed"
			}
		}
		historyCancel()
	}
	terminalCtx, terminalCancel := orchestrator.finalizationContext()
	defer terminalCancel()
	terminalErr := guard.Finalize(terminalCtx, terminalEvent(status, code))
	if terminalErr != nil {
		return terminalErr
	}
	return safeTerminalError(code, cause)
}

func prestreamOutcome(parent, current context.Context, cause error, fallback string) (history.TerminalStatus, string) {
	if parent != nil && errors.Is(parent.Err(), context.DeadlineExceeded) || current != nil && errors.Is(current.Err(), context.DeadlineExceeded) {
		return history.StatusCancelled, "deadline_exceeded"
	}
	if parent != nil && errors.Is(parent.Err(), context.Canceled) || current != nil && errors.Is(current.Err(), context.Canceled) {
		return history.StatusCancelled, "cancelled"
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		return history.StatusCancelled, "deadline_exceeded"
	}
	if errors.Is(cause, context.Canceled) {
		return history.StatusCancelled, "cancelled"
	}
	return history.StatusFailed, fallback
}
