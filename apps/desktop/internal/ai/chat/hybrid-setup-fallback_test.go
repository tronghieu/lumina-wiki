package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type setupSemanticSpy struct{ calls int }

func (spy *setupSemanticSpy) Search(context.Context, index.SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
	spy.calls++
	return nil, nil
}

func TestHybridRetrieverPrecomputedSemanticSetupFallbacksNeverCallSemanticDependencies(t *testing.T) {
	tests := []struct {
		name    string
		setup   error
		status  retrieval.SemanticStatus
		warning string
	}{
		{"empty", retrieval.ErrSemanticEmpty, retrieval.SemanticEmpty, ""},
		{"stale", retrieval.ErrSemanticStale, retrieval.SemanticStale, retrieval.WarningSemanticStale},
		{"corrupt", retrieval.ErrSemanticCorrupt, retrieval.SemanticCorrupt, retrieval.WarningSemanticCorrupt},
		{"unavailable", retrieval.ErrSemanticUnavailable, retrieval.SemanticUnavailable, retrieval.WarningSemanticUnavailable},
		{"canceled", context.Canceled, retrieval.SemanticCanceled, retrieval.WarningSemanticCanceled},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle", "wiki/b.md": "needle", "wiki/c.md": "needle"})
			provider := &embeddingSpy{}
			semantic := &setupSemanticSpy{}
			result, err := NewHybridRetriever(HybridConfig{Lexical: lexical, Provider: provider, Semantic: semantic,
				Metadata: SemanticMetadata{Enabled: true}, SemanticSetupError: test.setup}).Retrieve(context.Background(), "needle",
				retrieval.SearchOptions{SelectedPath: "wiki/b.md", LinkedPaths: []string{"wiki/c.md"}})
			if err != nil || result.SemanticStatus != test.status || result.WarningCode != test.warning || len(result.Hits) != 3 ||
				result.Hits[0].Path != "wiki/b.md" || result.Hits[1].Path != "wiki/c.md" || provider.calls != 0 || semantic.calls != 0 {
				t.Fatalf("result=%#v provider=%d semantic=%d err=%v", result, provider.calls, semantic.calls, err)
			}
		})
	}
}

func TestHybridRetrieverDisabledIgnoresSetupError(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	result, err := NewHybridRetriever(HybridConfig{Lexical: lexical, SemanticSetupError: errors.New("private setup")}).Retrieve(
		context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil || result.SemanticStatus != retrieval.SemanticDisabled || len(result.Hits) != 1 {
		t.Fatalf("disabled result=%#v err=%v", result, err)
	}
}
