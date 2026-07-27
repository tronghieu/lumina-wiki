package chat

import (
	"context"
	"regexp"
	"sync"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

const DefaultMaxEvents = 8192

var safeCodePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

type GuardLimits struct {
	MaxEvents     int
	MaxDeltaBytes int
	Cancel        func()
	Citations     []CitationDTO
}

type TerminalGuard struct {
	mu                                              sync.Mutex
	sink                                            EventSink
	limits                                          GuardLimits
	requestID, conversationID                       string
	semantic                                        SemanticInfo
	seq                                             uint64
	events, deltaBytes                              int
	started, terminal, usageSeen, delivering        bool
	lastUsageInput, lastUsageOutput, lastUsageTotal int
	sinkErr                                         error
	queue                                           []Event
	allowedCitations                                map[CitationDTO]bool
}

func NewTerminalGuard(sink EventSink, limits GuardLimits) *TerminalGuard {
	if limits.MaxEvents < 2 || limits.MaxEvents > DefaultMaxEvents {
		limits.MaxEvents = DefaultMaxEvents
	}
	if limits.MaxDeltaBytes <= 0 || limits.MaxDeltaBytes > history.MaxAssistantBytes {
		limits.MaxDeltaBytes = history.MaxAssistantBytes
	}
	allowed := make(map[CitationDTO]bool, len(limits.Citations))
	for _, citation := range limits.Citations {
		allowed[citation] = true
	}
	limits.Citations = nil
	return &TerminalGuard{sink: sink, limits: limits, allowedCitations: allowed}
}

func (guard *TerminalGuard) Start(ctx context.Context, requestID, conversationID string, semantic SemanticInfo) error {
	if !validRunID(requestID) || !validRunID(conversationID) {
		return ErrInvalidRequest
	}
	guard.mu.Lock()
	if guard.started || guard.terminal {
		guard.mu.Unlock()
		return ErrInvalidStream
	}
	guard.started, guard.requestID, guard.conversationID, guard.semantic = true, requestID, conversationID, semantic
	drain := guard.enqueueLocked(Event{Kind: EventStarted})
	guard.mu.Unlock()
	if drain {
		return guard.drain(ctx)
	}
	return nil
}

func (guard *TerminalGuard) Emit(ctx context.Context, event Event) error {
	guard.mu.Lock()
	if guard.terminal {
		guard.mu.Unlock()
		return nil
	}
	if !guard.started || !validNonterminal(event) {
		guard.mu.Unlock()
		return ErrInvalidStream
	}
	if event.Kind == EventDelta {
		if !utf8.ValidString(event.Delta) || event.Delta == "" || guard.deltaBytes > guard.limits.MaxDeltaBytes-len(event.Delta) {
			guard.mu.Unlock()
			guard.cancel()
			return ErrStreamLimit
		}
		guard.deltaBytes += len(event.Delta)
	}
	if guard.events >= guard.limits.MaxEvents-1 {
		guard.mu.Unlock()
		guard.cancel()
		return ErrStreamLimit
	}
	if event.Kind == EventUsage {
		if event.Usage == nil || guard.usageSeen || event.Usage.InputTokens < guard.lastUsageInput || event.Usage.OutputTokens < guard.lastUsageOutput || event.Usage.TotalTokens < guard.lastUsageTotal || event.Usage.InputTokens < 0 || event.Usage.OutputTokens < 0 || event.Usage.TotalTokens < 0 {
			guard.mu.Unlock()
			return ErrInvalidStream
		}
		guard.usageSeen = true
		guard.lastUsageInput, guard.lastUsageOutput, guard.lastUsageTotal = event.Usage.InputTokens, event.Usage.OutputTokens, event.Usage.TotalTokens
	}
	if event.Kind == EventCitation && (event.Citation == nil || !guard.allowedCitations[*event.Citation]) {
		guard.mu.Unlock()
		return ErrInvalidStream
	}
	drain := guard.enqueueLocked(event)
	guard.mu.Unlock()
	if drain {
		return guard.drain(ctx)
	}
	return nil
}

func (guard *TerminalGuard) Finalize(ctx context.Context, event Event) error {
	guard.mu.Lock()
	if guard.terminal {
		err := guard.sinkErr
		guard.mu.Unlock()
		return err
	}
	if !guard.started || !validTerminal(event) {
		guard.mu.Unlock()
		return ErrInvalidStream
	}
	guard.terminal = true
	guard.sinkErr = nil
	drain := guard.enqueueLocked(event)
	guard.mu.Unlock()
	if drain {
		return guard.drain(ctx)
	}
	return nil
}

func (guard *TerminalGuard) Terminal() bool {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	return guard.terminal
}

func (guard *TerminalGuard) enqueueLocked(event Event) bool {
	guard.events++
	guard.seq++
	event.Seq, event.RequestID, event.ConversationID, event.Semantic = guard.seq, guard.requestID, guard.conversationID, guard.semantic
	guard.queue = append(guard.queue, event)
	if guard.delivering {
		return false
	}
	guard.delivering = true
	return true
}

func (guard *TerminalGuard) drain(ctx context.Context) error {
	var deliveryErr error
	for {
		guard.mu.Lock()
		if guard.sinkErr != nil {
			err := guard.sinkErr
			guard.delivering = false
			guard.mu.Unlock()
			return err
		}
		if len(guard.queue) == 0 {
			guard.delivering = false
			guard.mu.Unlock()
			return deliveryErr
		}
		next := guard.queue[0]
		guard.queue = guard.queue[1:]
		sink := guard.sink
		guard.mu.Unlock()
		if sink == nil {
			guard.fail(ErrInvalidStream)
			return ErrInvalidStream
		}
		if err := sink.OnEvent(ctx, next); err != nil {
			if !isTerminal(next.Kind) && guard.preserveQueuedTerminal() {
				guard.cancel()
				deliveryErr = ErrSink
				continue
			}
			guard.fail(ErrSink)
			return ErrSink
		}
	}
}
