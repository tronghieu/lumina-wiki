package chat

import (
	"time"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

func buildHistoryRecord(request Request, created, finished time.Time, status history.TerminalStatus, code, output string, citations []CitationDTO, usage *providers.Usage) history.ConversationRecord {
	record := history.ConversationRecord{SchemaVersion: history.CurrentSchemaVersion, ConversationID: request.ConversationID, AttemptID: request.AttemptID,
		RetryOfAttemptID: request.RetryOfAttemptID, CreatedAt: created, FinishedAt: finished, Status: status, AssistantOutput: output, ErrorCode: code}
	if request.RetryOfAttemptID == "" {
		record.UserMessage = request.Question
	}
	if usage != nil {
		record.Usage = history.UsageCounts{InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens}
	}
	for _, citation := range citations {
		record.Citations = append(record.Citations, history.Citation{ID: citation.CitationID, Label: boundedLabel(citation.Path)})
	}
	return record
}

func boundedLabel(value string) string {
	if len(value) <= history.MaxCitationLabelBytes {
		return value
	}
	for len(value) > history.MaxCitationLabelBytes {
		_, size := utf8.DecodeLastRuneInString(value)
		value = value[:len(value)-size]
	}
	return value
}
