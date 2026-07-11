package history

import (
	"errors"
	"regexp"
	"sort"
	"time"
	"unicode/utf8"
)

const (
	CurrentSchemaVersion       = 1
	MaxIDBytes                 = 64
	MaxUserMessageBytes        = 64 * 1024
	MaxAssistantBytes          = 256 * 1024
	MaxCitationIDBytes         = 128
	MaxCitationLabelBytes      = 256
	MaxErrorCodeBytes          = 64
	MaxCitations               = 64
	MaxAttemptsPerConversation = 128
	MaxConversations           = 256
	MaxRecordBytes             = 384 * 1024
	MaxConversationFileBytes   = 4 * 1024 * 1024
	MaxWorkspaceBytes          = 16 * 1024 * 1024
)

var (
	idPattern          = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	errorCodePattern   = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	ErrAttemptConflict = errors.New("history attempt conflicts with existing record")
)

type TerminalStatus string

const (
	StatusCompleted TerminalStatus = "completed"
	StatusFailed    TerminalStatus = "failed"
	StatusCancelled TerminalStatus = "cancelled"
)

type Citation struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type UsageCounts struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
}

type ConversationRecord struct {
	SchemaVersion int `json:"schemaVersion"`
	// ConversationID may contain multiple root attempts: one per user turn.
	ConversationID string `json:"conversationId"`
	AttemptID      string `json:"attemptId"`
	// RetryOfAttemptID links within one root turn's retry lineage.
	RetryOfAttemptID string         `json:"retryOfAttemptId,omitempty"`
	CreatedAt        time.Time      `json:"createdAt"`
	FinishedAt       time.Time      `json:"finishedAt"`
	Status           TerminalStatus `json:"status"`
	UserMessage      string         `json:"userMessage,omitempty"`
	AssistantOutput  string         `json:"assistantOutput,omitempty"`
	Citations        []Citation     `json:"citations,omitempty"`
	ErrorCode        string         `json:"errorCode,omitempty"`
	Usage            UsageCounts    `json:"usage"`
}

type ConversationMetadata struct {
	ConversationID string         `json:"conversationId"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	Attempts       int            `json:"attempts"`
	LatestStatus   TerminalStatus `json:"latestStatus"`
}

type AppendOutcome string

type DeleteResult struct {
	Removed bool `json:"removed"`
	Durable bool `json:"durable"`
}

type DeleteAllResult struct {
	DeletedIDs          []string `json:"deletedIds"`
	DurableDeletedIDs   []string `json:"durableDeletedIds"`
	UncertainDeletedIDs []string `json:"uncertainDeletedIds"`
	RemainingIDs        []string `json:"remainingIds"`
	Durable             bool     `json:"durable"`
}

const (
	AppendStored     AppendOutcome = "stored"
	AppendIdempotent AppendOutcome = "idempotent"
	AppendDisabled   AppendOutcome = "disabled"
)

func (record ConversationRecord) Validate() error {
	if record.SchemaVersion != CurrentSchemaVersion || !validID(record.ConversationID) || !validID(record.AttemptID) {
		return errors.New("history record identity is invalid")
	}
	if record.RetryOfAttemptID != "" && !validID(record.RetryOfAttemptID) {
		return errors.New("history retry identity is invalid")
	}
	if record.CreatedAt.IsZero() || record.FinishedAt.IsZero() || record.FinishedAt.Before(record.CreatedAt) {
		return errors.New("history timestamps are invalid")
	}
	if record.Status != StatusCompleted && record.Status != StatusFailed && record.Status != StatusCancelled {
		return errors.New("history status is invalid")
	}
	if record.RetryOfAttemptID == "" && record.UserMessage == "" {
		return errors.New("original attempt requires user message")
	}
	if record.RetryOfAttemptID != "" && record.UserMessage != "" {
		return errors.New("retry must omit user message")
	}
	if !validText(record.UserMessage, MaxUserMessageBytes) || !validText(record.AssistantOutput, MaxAssistantBytes) {
		return errors.New("history text is invalid")
	}
	if record.ErrorCode != "" && (!errorCodePattern.MatchString(record.ErrorCode) || len(record.ErrorCode) > MaxErrorCodeBytes) {
		return errors.New("history error code is invalid")
	}
	if record.Usage.InputTokens < 0 || record.Usage.OutputTokens < 0 || len(record.Citations) > MaxCitations {
		return errors.New("history usage or citations are invalid")
	}
	for _, citation := range record.Citations {
		if !validIDText(citation.ID, MaxCitationIDBytes) || !validIDText(citation.Label, MaxCitationLabelBytes) {
			return errors.New("history citation is invalid")
		}
	}
	return nil
}

func validID(value string) bool { return len(value) <= MaxIDBytes && idPattern.MatchString(value) }

func validText(value string, max int) bool { return len(value) <= max && utf8.ValidString(value) }

func validIDText(value string, max int) bool { return value != "" && validText(value, max) }

func sortAttempts(records []ConversationRecord) {
	sort.Slice(records, func(i, j int) bool {
		if records[i].CreatedAt.Equal(records[j].CreatedAt) {
			return records[i].AttemptID < records[j].AttemptID
		}
		return records[i].CreatedAt.Before(records[j].CreatedAt)
	})
}
