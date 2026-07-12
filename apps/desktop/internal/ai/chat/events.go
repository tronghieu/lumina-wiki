package chat

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

type EventKind string

const (
	EventStarted   EventKind = "started"
	EventDelta     EventKind = "delta"
	EventCitation  EventKind = "citation"
	EventUsage     EventKind = "usage"
	EventCompleted EventKind = "completed"
	EventFailed    EventKind = "failed"
	EventCancelled EventKind = "cancelled"
)

type SemanticInfo struct {
	Status  string `json:"status"`
	Warning string `json:"warning,omitempty"`
}

type CitationDiagnostics struct {
	Unknown    int `json:"unknown"`
	Malformed  int `json:"malformed"`
	OutOfRange int `json:"outOfRange"`
}

type Event struct {
	Kind                EventKind           `json:"kind"`
	RequestID           string              `json:"requestId"`
	ConversationID      string              `json:"conversationId"`
	Seq                 uint64              `json:"seq"`
	Delta               string              `json:"delta,omitempty"`
	Citation            *CitationDTO        `json:"citation,omitempty"`
	Usage               *providers.Usage    `json:"usage,omitempty"`
	ErrorCode           string              `json:"errorCode,omitempty"`
	Semantic            SemanticInfo        `json:"semantic"`
	CitationDiagnostics CitationDiagnostics `json:"citationDiagnostics"`
}

type EventSink interface {
	OnEvent(context.Context, Event) error
}
