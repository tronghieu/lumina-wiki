package chat

import (
	"context"
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func (orchestrator *Orchestrator) Run(parent context.Context, request Request, sink EventSink) error {
	if err := validateRunRequest(parent, request); err != nil {
		return err
	}
	if orchestrator == nil || orchestrator.config.Retriever == nil || orchestrator.config.Retriever.Lexical() == nil || orchestrator.config.Provider == nil || sink == nil {
		return ErrInvalidRequest
	}
	if request.HistoryEnabled && orchestrator.config.History == nil {
		return ErrInvalidRequest
	}
	citationRun, err := orchestrator.config.Citations.Begin(request.RequestID)
	if err != nil {
		return err
	}
	defer citationRun.End()
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	limits := orchestrator.config.GuardLimits
	upstreamCancel := limits.Cancel
	limits.Cancel = func() {
		cancel()
		if upstreamCancel != nil {
			upstreamCancel()
		}
	}
	result, err := orchestrator.config.Retriever.Retrieve(ctx, request.Question, retrieval.SearchOptions{Limit: MaxEvidenceEntries, SelectedPath: request.SelectedPath, LinkedPaths: request.LinkedPaths})
	if err != nil {
		return orchestrator.finalizeEarly(parent, ctx, request, sink, "retrieval_failed", err)
	}
	allowlist, err := NewEvidenceAllowlist(ctx, orchestrator.config.Retriever.Lexical(), result.Hits, retrieval.CitationOptions{})
	if err != nil {
		return orchestrator.finalizeEarly(parent, ctx, request, sink, "evidence_failed", err)
	}
	leaseTransferred := false
	defer func() {
		if !leaseTransferred {
			allowlist.Close()
		}
	}()
	built, err := orchestrator.config.Builder.Build(BuildInput{Profile: request.Profile, Question: request.Question, History: request.History, Evidence: allowlist})
	if err != nil {
		return orchestrator.finalizeEarly(parent, ctx, request, sink, "context_failed", err)
	}
	scope, err := NewEvidenceScope(allowlist, built.EvidenceIDs)
	if err != nil {
		return orchestrator.finalizeEarly(parent, ctx, request, sink, "evidence_failed", err)
	}
	limits.Citations = scope.citationDTOs()
	semantic := SemanticInfo{Status: string(result.SemanticStatus), Warning: result.WarningCode}
	guard := NewTerminalGuard(sink, limits)
	if err := guard.Start(ctx, request.RequestID, request.ConversationID, semantic); err != nil {
		return orchestrator.finalizeWithGuard(parent, nil, request, guard, true, "stream_start_failed", err)
	}
	started := orchestrator.config.Clock().UTC()
	bridge := &providerBridge{guard: guard, output: make([]byte, 0, 1024)}
	streamErr := orchestrator.config.Provider.Stream(ctx, built.Request, bridge)
	status, code := classifyOutcome(parent, ctx, streamErr, bridge.failureCode)
	if status == history.StatusCompleted && bridge.acceptedDeltas == 0 {
		status, code = history.StatusFailed, "empty_completion"
	}
	var extraction CitationExtraction
	if status == history.StatusCompleted {
		extraction, err = scope.Extract(string(bridge.output))
		if err != nil {
			status, code = history.StatusFailed, "invalid_provider_output"
		}
	}
	if status == history.StatusCompleted && len(extraction.Citations) > 0 {
		leaseTransferred, err = publishCitationLease(citationRun, scope, extraction.Citations)
		if err != nil {
			status, code = history.StatusFailed, "citation_lease_failed"
		}
	}
	if status == history.StatusCompleted {
		status, code = emitPostStream(ctx, parent, guard, extraction.Citations, bridge.usage)
		if status != history.StatusCompleted && leaseTransferred {
			citationRun.Revoke()
		}
	}
	finished := orchestrator.config.Clock().UTC()
	if finished.Before(started) {
		finished = started
	}
	record := buildHistoryRecord(request, started, finished, status, code, string(bridge.output), extraction.Citations, bridge.usage)
	if request.HistoryEnabled {
		historyCtx, historyCancel := orchestrator.finalizationContext()
		outcome, appendErr := orchestrator.config.History.Append(historyCtx, record)
		if status != history.StatusCancelled {
			if appendErr != nil || outcome != history.AppendStored && outcome != history.AppendIdempotent {
				status, code = history.StatusFailed, "history_write_failed"
			}
			if errors.Is(appendErr, context.DeadlineExceeded) || errors.Is(historyCtx.Err(), context.DeadlineExceeded) {
				status, code = history.StatusFailed, "history_write_timeout"
			}
		}
		historyCancel()
	}
	if status != history.StatusCompleted && leaseTransferred {
		citationRun.Revoke()
	}
	terminal := terminalEvent(status, code)
	terminal.CitationDiagnostics = CitationDiagnostics{Unknown: extraction.UnknownCount, Malformed: extraction.MalformedCount, OutOfRange: extraction.OutOfRangeCount}
	terminalCtx, terminalCancel := orchestrator.finalizationContext()
	defer terminalCancel()
	if finalErr := guard.Finalize(terminalCtx, terminal); finalErr != nil {
		if leaseTransferred {
			citationRun.Revoke()
		}
		return finalErr
	}
	if status != history.StatusCompleted {
		return safeTerminalError(code, streamErr)
	}
	return nil
}

func validateRunRequest(ctx context.Context, request Request) error {
	if ctx == nil || ctx.Err() != nil {
		if ctx != nil {
			return ctx.Err()
		}
		return ErrInvalidRequest
	}
	if !validRunID(request.RequestID) || !validRunID(request.ConversationID) || !validRunID(request.AttemptID) || request.RetryOfAttemptID != "" && !validRunID(request.RetryOfAttemptID) ||
		!validTurnText(request.Question) || len(request.Question) > retrieval.MaxQueryBytes || len(request.History) > providers.MaxProviderTurns-1 || len(request.LinkedPaths) > retrieval.MaxLinkedPathInputs {
		return ErrInvalidRequest
	}
	profile, err := request.Profile.Normalized()
	if err != nil || profile.Role != settings.RoleChat || utf8.RuneCountInString(request.Question) > profile.MaxInputChars || !validRequestPath(request.SelectedPath) {
		return ErrInvalidRequest
	}
	for _, turn := range request.History {
		if (turn.Role != "user" && turn.Role != "assistant") || !validTurnText(turn.Content) || utf8.RuneCountInString(turn.Content) > providers.MaxProviderTurnChars {
			return ErrInvalidRequest
		}
	}
	seen := map[string]bool{}
	for _, path := range request.LinkedPaths {
		if !validRequestPath(path) {
			return ErrInvalidRequest
		}
		seen[path] = true
	}
	if len(seen) > retrieval.MaxLinkedPaths {
		return ErrInvalidRequest
	}
	return nil
}

func validRunID(value string) bool {
	return value != "" && len(value) <= MaxRequestIDBytes && utf8.ValidString(value) && safeIDPattern.MatchString(value)
}

func validRequestPath(value string) bool {
	if value == "" {
		return true
	}
	if !utf8.ValidString(value) || len(value) > retrieval.MaxRelativePathBytes || strings.Contains(value, "\\") {
		return false
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(value)))
	return clean == value && strings.HasPrefix(value, "wiki/") && strings.HasSuffix(value, ".md") && !strings.Contains(value, "/../")
}

func safeTerminalError(code string, cause error) error {
	if code == "cancelled" {
		return context.Canceled
	}
	if code == "deadline_exceeded" {
		return context.DeadlineExceeded
	}
	return providers.NewSafeError(code, "The chat request failed.", cause)
}
func terminalEvent(status history.TerminalStatus, code string) Event {
	if status == history.StatusCompleted {
		return Event{Kind: EventCompleted}
	}
	if status == history.StatusCancelled {
		return Event{Kind: EventCancelled, ErrorCode: code}
	}
	return Event{Kind: EventFailed, ErrorCode: code}
}

var safeIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
