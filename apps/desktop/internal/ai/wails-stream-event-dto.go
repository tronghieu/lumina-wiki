package ai

import "github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"

func newChatStreamEventDTO(event chat.Event) ChatStreamEventDTO {
	result := ChatStreamEventDTO{
		Kind: string(event.Kind), RequestID: event.RequestID, ConversationID: event.ConversationID,
		Seq: event.Seq, Delta: event.Delta, ErrorCode: event.ErrorCode,
		Semantic: SemanticDTO{Status: event.Semantic.Status, Warning: event.Semantic.Warning},
		CitationDiagnostics: CitationDiagnosticsDTO{
			Unknown: event.CitationDiagnostics.Unknown, Malformed: event.CitationDiagnostics.Malformed,
			OutOfRange: event.CitationDiagnostics.OutOfRange,
		},
	}
	if event.Citation != nil {
		result.Citation = &ChatCitationDTO{
			ModelID: event.Citation.ModelID, CitationID: event.Citation.CitationID,
			Path: event.Citation.Path, Heading: event.Citation.Heading,
			Start: event.Citation.Start, End: event.Citation.End,
		}
	}
	if event.Usage != nil {
		result.Usage = &UsageDTO{
			InputTokens: event.Usage.InputTokens, OutputTokens: event.Usage.OutputTokens,
			TotalTokens: event.Usage.TotalTokens,
		}
	}
	return result
}
