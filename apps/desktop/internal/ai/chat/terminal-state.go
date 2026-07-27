package chat

import "errors"

func (guard *TerminalGuard) fail(err error) {
	guard.mu.Lock()
	if guard.sinkErr == nil {
		guard.sinkErr = err
	}
	guard.queue = nil
	guard.delivering = false
	guard.mu.Unlock()
	guard.cancel()
}

func (guard *TerminalGuard) cancel() {
	if guard.limits.Cancel != nil {
		guard.limits.Cancel()
	}
}

func (guard *TerminalGuard) preserveQueuedTerminal() bool {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	for _, event := range guard.queue {
		if isTerminal(event.Kind) {
			guard.queue = []Event{event}
			return true
		}
	}
	return false
}

func isTerminal(kind EventKind) bool {
	return kind == EventCompleted || kind == EventFailed || kind == EventCancelled
}

func validTerminal(event Event) bool {
	if !isTerminal(event.Kind) || event.RequestID != "" || event.ConversationID != "" || event.Seq != 0 || event.Semantic != (SemanticInfo{}) || event.Delta != "" || event.Citation != nil || event.Usage != nil {
		return false
	}
	if event.CitationDiagnostics.Unknown < 0 || event.CitationDiagnostics.Malformed < 0 || event.CitationDiagnostics.OutOfRange < 0 {
		return false
	}
	if event.Kind == EventCompleted {
		return event.ErrorCode == ""
	}
	return safeCodePattern.MatchString(event.ErrorCode)
}

func validNonterminal(event Event) bool {
	if event.RequestID != "" || event.ConversationID != "" || event.Seq != 0 || event.ErrorCode != "" || event.Semantic != (SemanticInfo{}) || event.CitationDiagnostics != (CitationDiagnostics{}) {
		return false
	}
	if event.Kind == EventDelta {
		return event.Delta != "" && event.Citation == nil && event.Usage == nil
	}
	if event.Kind == EventCitation {
		return event.Citation != nil && event.Delta == "" && event.Usage == nil
	}
	return event.Kind == EventUsage && event.Usage != nil && event.Delta == "" && event.Citation == nil
}

var (
	ErrInvalidRequest = errors.New("invalid chat request")
	ErrInvalidStream  = errors.New("invalid chat stream")
	ErrStreamLimit    = errors.New("chat stream limit exceeded")
	ErrSink           = errors.New("chat event sink failed")
)
