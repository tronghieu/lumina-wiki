package chat

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

func emitPostStream(ctx, parent context.Context, guard *TerminalGuard, citations []CitationDTO, usage *providers.Usage) (history.TerminalStatus, string) {
	for i := range citations {
		citation := citations[i]
		if err := guard.Emit(ctx, Event{Kind: EventCitation, Citation: &citation}); err != nil {
			return emissionFailure(parent, err)
		}
	}
	if usage != nil {
		if err := guard.Emit(ctx, Event{Kind: EventUsage, Usage: usage}); err != nil {
			return emissionFailure(parent, err)
		}
	}
	return history.StatusCompleted, ""
}

func emissionFailure(parent context.Context, err error) (history.TerminalStatus, string) {
	if errors.Is(parent.Err(), context.DeadlineExceeded) {
		return history.StatusCancelled, "deadline_exceeded"
	}
	if errors.Is(parent.Err(), context.Canceled) {
		return history.StatusCancelled, "cancelled"
	}
	if errors.Is(err, ErrStreamLimit) {
		return history.StatusFailed, "event_limit"
	}
	return history.StatusFailed, "sink_failed"
}

func publishCitationLease(run *CitationLeaseRun, scope *EvidenceScope, citations []CitationDTO) (bool, error) {
	lease, err := NewCitationLease(scope, citations)
	if err != nil {
		return false, err
	}
	if err := run.Replace(lease); err != nil {
		lease.Close()
		return false, err
	}
	return true, nil
}
