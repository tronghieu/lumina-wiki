package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

var (
	ErrChatRequestActive   = errors.New("chat request already active")
	ErrChatUnavailable     = errors.New("chat is unavailable")
	ErrCitationUnavailable = errors.New("citation is unavailable")
)

type ProfileSelectionDTO struct {
	ChatProfileID      string `json:"chatProfileId"`
	EmbeddingProfileID string `json:"embeddingProfileId,omitempty"`
}

type ChatHistoryOptionsDTO struct {
	Include bool `json:"include"`
	Persist bool `json:"persist"`
}

type ChatRequestDTO struct {
	Session        SessionReferenceDTO   `json:"session"`
	RequestID      string                `json:"requestId"`
	ConversationID string                `json:"conversationId"`
	Question       string                `json:"question"`
	Profiles       ProfileSelectionDTO   `json:"profiles"`
	History        ChatHistoryOptionsDTO `json:"history"`
	SelectedPath   string                `json:"selectedPath,omitempty"`
	LinkedPaths    []string              `json:"linkedPaths,omitempty"`
}

type ChatCompletionDTO struct {
	RequestID      string `json:"requestId"`
	ConversationID string `json:"conversationId"`
}

type CitationReadRequestDTO struct {
	Session    SessionReferenceDTO `json:"session"`
	RequestID  string              `json:"requestId"`
	CitationID string              `json:"citationId"`
}

type CitationNoteDTO struct {
	Path    string `json:"path"`
	Heading string `json:"heading"`
	Content string `json:"content"`
}

type ChatEventDTO struct {
	Session SessionReferenceDTO `json:"session"`
	Event   ChatStreamEventDTO  `json:"event"`
}

type ChatStreamEventDTO struct {
	Kind                string                 `json:"kind"`
	RequestID           string                 `json:"requestId"`
	ConversationID      string                 `json:"conversationId"`
	Seq                 uint64                 `json:"seq"`
	Delta               string                 `json:"delta,omitempty"`
	Citation            *ChatCitationDTO       `json:"citation,omitempty"`
	Usage               *UsageDTO              `json:"usage,omitempty"`
	ErrorCode           string                 `json:"errorCode,omitempty"`
	Semantic            SemanticDTO            `json:"semantic"`
	CitationDiagnostics CitationDiagnosticsDTO `json:"citationDiagnostics"`
}

type ChatCitationDTO struct {
	ModelID    string `json:"modelId"`
	CitationID string `json:"citationId"`
	Path       string `json:"path"`
	Heading    string `json:"heading"`
	Start      int    `json:"start"`
	End        int    `json:"end"`
}

type UsageDTO struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
	TotalTokens  int `json:"totalTokens"`
}

type SemanticDTO struct {
	Status  string `json:"status"`
	Warning string `json:"warning,omitempty"`
}

type CitationDiagnosticsDTO struct {
	Unknown    int `json:"unknown"`
	Malformed  int `json:"malformed"`
	OutOfRange int `json:"outOfRange"`
}

type StreamSinkFactory interface {
	NewChatSink(context.Context, session.WindowID, SessionReferenceDTO) (chat.EventSink, error)
}

type runtimeChatRequest struct {
	RequestID, ConversationID string
	Question                  string
	Profiles                  ProfileSelectionDTO
	History                   ChatHistoryOptionsDTO
	SelectedPath              string
	LinkedPaths               []string
}

type chatCapableRuntime interface {
	session.Runtime
	RunChat(context.Context, runtimeChatRequest, chat.EventSink) error
	ReadCitationNote(context.Context, string, string) (retrieval.CitationNote, error)
}
