package ai

import (
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func TestWailsSemanticInfoAcceptsOnlyExactStatusWarningPairs(t *testing.T) {
	valid := []chat.SemanticInfo{
		{Status: string(retrieval.SemanticReady)},
		{Status: string(retrieval.SemanticDisabled)},
		{Status: string(retrieval.SemanticEmpty)},
		{Status: string(retrieval.SemanticUnavailable), Warning: retrieval.WarningSemanticUnavailable},
		{Status: string(retrieval.SemanticStale), Warning: retrieval.WarningSemanticStale},
		{Status: string(retrieval.SemanticCorrupt), Warning: retrieval.WarningSemanticCorrupt},
		{Status: string(retrieval.SemanticCanceled), Warning: retrieval.WarningSemanticCanceled},
	}
	for _, info := range valid {
		if !validSemanticInfo(info) {
			t.Fatalf("rejected valid pair: %#v", info)
		}
	}
	invalid := []chat.SemanticInfo{
		{Status: string(retrieval.SemanticReady), Warning: retrieval.WarningSemanticUnavailable},
		{Status: string(retrieval.SemanticDisabled), Warning: retrieval.WarningSemanticStale},
		{Status: string(retrieval.SemanticEmpty), Warning: retrieval.WarningSemanticUnavailable},
		{Status: string(retrieval.SemanticUnavailable)},
		{Status: string(retrieval.SemanticUnavailable), Warning: retrieval.WarningSemanticStale},
		{Status: string(retrieval.SemanticStale)},
		{Status: string(retrieval.SemanticStale), Warning: retrieval.WarningSemanticCorrupt},
		{Status: string(retrieval.SemanticCorrupt)},
		{Status: string(retrieval.SemanticCorrupt), Warning: retrieval.WarningSemanticCanceled},
		{Status: string(retrieval.SemanticCanceled)},
		{Status: string(retrieval.SemanticCanceled), Warning: retrieval.WarningSemanticUnavailable},
		{Status: "unknown", Warning: retrieval.WarningSemanticUnavailable},
	}
	for _, info := range invalid {
		if validSemanticInfo(info) {
			t.Fatalf("accepted invalid pair: %#v", info)
		}
	}
}

func TestWailsCitationRequiresNonzeroValidSpan(t *testing.T) {
	valid := &chat.CitationDTO{ModelID: "S1", CitationID: bridgeCitationID, Path: "wiki/a.md", Heading: "A", Start: 2, End: 3}
	if !validWailsCitation(valid) {
		t.Fatal("valid citation rejected")
	}
	for name, mutate := range map[string]func(*chat.CitationDTO){
		"zero":     func(value *chat.CitationDTO) { value.Start, value.End = 0, 0 },
		"equal":    func(value *chat.CitationDTO) { value.Start, value.End = 2, 2 },
		"reversed": func(value *chat.CitationDTO) { value.Start, value.End = 3, 2 },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := *valid
			mutate(&candidate)
			if validWailsCitation(&candidate) {
				t.Fatalf("accepted span %d:%d", candidate.Start, candidate.End)
			}
		})
	}
}
