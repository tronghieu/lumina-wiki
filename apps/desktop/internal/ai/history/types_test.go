package history

import (
	"strings"
	"testing"
	"time"
)

func TestConversationRecordValidationAndPrivacy(t *testing.T) {
	original := validRecord("conversation-a", "attempt-a")
	if err := original.Validate(); err != nil {
		t.Fatalf("valid original rejected: %v", err)
	}
	retry := original
	retry.AttemptID = "attempt-b"
	retry.RetryOfAttemptID = original.AttemptID
	retry.UserMessage = ""
	if err := retry.Validate(); err != nil {
		t.Fatalf("valid retry rejected: %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*ConversationRecord)
	}{
		{"unknown version", func(r *ConversationRecord) { r.SchemaVersion++ }},
		{"unknown status", func(r *ConversationRecord) { r.Status = TerminalStatus("running") }},
		{"unfinished", func(r *ConversationRecord) { r.FinishedAt = time.Time{} }},
		{"finish before create", func(r *ConversationRecord) { r.FinishedAt = r.CreatedAt.Add(-time.Second) }},
		{"retry repeats user", func(r *ConversationRecord) { r.RetryOfAttemptID = "attempt-old" }},
		{"original omits user", func(r *ConversationRecord) { r.UserMessage = "" }},
		{"invalid utf8", func(r *ConversationRecord) { r.AssistantOutput = string([]byte{0xff}) }},
		{"overlong output", func(r *ConversationRecord) { r.AssistantOutput = strings.Repeat("x", MaxAssistantBytes+1) }},
		{"too many citations", func(r *ConversationRecord) { r.Citations = make([]Citation, MaxCitations+1) }},
		{"unsafe error", func(r *ConversationRecord) { r.ErrorCode = "path=/Users/alice/secret" }},
		{"negative usage", func(r *ConversationRecord) { r.Usage.InputTokens = -1 }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := original
			test.mutate(&record)
			if err := record.Validate(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestRecordJSONContainsOnlyApprovedFields(t *testing.T) {
	raw, err := encodeRecord(validRecord("conversation-a", "attempt-a"))
	if err != nil {
		t.Fatalf("encode record: %v", err)
	}
	for _, forbidden := range []string{"providerRaw", "systemPrompt", "evidenceExcerpt", "credential", "/Users/"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("persisted record exposed forbidden field %q", forbidden)
		}
	}
}

func validRecord(conversationID, attemptID string) ConversationRecord {
	created := time.Date(2026, 7, 11, 10, 0, 0, 0, time.UTC)
	return ConversationRecord{
		SchemaVersion:   CurrentSchemaVersion,
		ConversationID:  conversationID,
		AttemptID:       attemptID,
		CreatedAt:       created,
		FinishedAt:      created.Add(time.Second),
		Status:          StatusCompleted,
		UserMessage:     "What is grounded cognition?",
		AssistantOutput: "A concise answer.",
		Citations:       []Citation{{ID: "source-a", Label: "Source A"}},
		Usage:           UsageCounts{InputTokens: 12, OutputTokens: 8},
	}
}
