package ai

import (
	"regexp"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

var (
	wailsCodePattern    = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	wailsModelIDPattern = regexp.MustCompile(`^S([1-9]|[1-5][0-9]|6[0-4])$`)
)

func validWailsChatEvent(event chat.Event) bool {
	if !validChatEventID(event.RequestID) || !validChatEventID(event.ConversationID) || event.Seq == 0 || !validSemanticInfo(event.Semantic) {
		return false
	}
	noPayload := event.Delta == "" && event.Citation == nil && event.Usage == nil
	noDiagnostics := event.CitationDiagnostics == (chat.CitationDiagnostics{})
	switch event.Kind {
	case chat.EventStarted:
		return noPayload && noDiagnostics && event.ErrorCode == ""
	case chat.EventDelta:
		return event.Delta != "" && len(event.Delta) <= history.MaxAssistantBytes && utf8.ValidString(event.Delta) &&
			event.Citation == nil && event.Usage == nil && event.ErrorCode == "" && noDiagnostics
	case chat.EventCitation:
		return event.Delta == "" && validWailsCitation(event.Citation) && event.Usage == nil && event.ErrorCode == "" && noDiagnostics
	case chat.EventUsage:
		return event.Delta == "" && event.Citation == nil && validWailsUsage(event) && event.ErrorCode == "" && noDiagnostics
	case chat.EventCompleted:
		return noPayload && event.ErrorCode == "" && validDiagnostics(event.CitationDiagnostics)
	case chat.EventFailed, chat.EventCancelled:
		return noPayload && wailsCodePattern.MatchString(event.ErrorCode) && validDiagnostics(event.CitationDiagnostics)
	default:
		return false
	}
}

func validSemanticInfo(info chat.SemanticInfo) bool {
	switch info.Status {
	case string(retrieval.SemanticReady), string(retrieval.SemanticDisabled), string(retrieval.SemanticEmpty):
		return info.Warning == ""
	case string(retrieval.SemanticUnavailable):
		return info.Warning == retrieval.WarningSemanticUnavailable
	case string(retrieval.SemanticStale):
		return info.Warning == retrieval.WarningSemanticStale
	case string(retrieval.SemanticCorrupt):
		return info.Warning == retrieval.WarningSemanticCorrupt
	case string(retrieval.SemanticCanceled):
		return info.Warning == retrieval.WarningSemanticCanceled
	default:
		return false
	}
}

func validWailsCitation(citation *chat.CitationDTO) bool {
	if citation == nil || !wailsModelIDPattern.MatchString(citation.ModelID) || !citationIDPattern.MatchString(citation.CitationID) ||
		!validRelativeWikiPath(citation.Path, false) || citation.Start < 0 || citation.End <= citation.Start ||
		len(citation.Heading) > maxCitationHeadingBytes || !utf8.ValidString(citation.Heading) {
		return false
	}
	for _, character := range citation.Heading {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

func validWailsUsage(event chat.Event) bool {
	return event.Usage != nil && event.Usage.InputTokens >= 0 && event.Usage.OutputTokens >= 0 && event.Usage.TotalTokens >= 0
}

func validDiagnostics(diagnostics chat.CitationDiagnostics) bool {
	return diagnostics.Unknown >= 0 && diagnostics.Malformed >= 0 && diagnostics.OutOfRange >= 0
}
