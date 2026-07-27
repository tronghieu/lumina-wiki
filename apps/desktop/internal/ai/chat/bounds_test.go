package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type distinctRandom struct{ call byte }

func (random *distinctRandom) Read(value []byte) (int, error) {
	random.call++
	for i := range value {
		value[i] = random.call
	}
	return len(value), nil
}

func TestAllowlistCapsEvidenceAt64AndRawCandidates(t *testing.T) {
	notes := make(map[string]string, MaxEvidenceEntries+1)
	for i := 0; i <= MaxEvidenceEntries; i++ {
		notes[fmt.Sprintf("wiki/n-%02d.md", i)] = fmt.Sprintf("needle unique-%02d", i)
	}
	index, _ := testIndex(t, notes)
	result, err := index.Search(context.Background(), "needle", retrieval.SearchOptions{Limit: MaxEvidenceEntries + 1})
	if err != nil {
		t.Fatal(err)
	}
	random := &distinctRandom{}
	allowlist, err := NewEvidenceAllowlist(context.Background(), index, result.Hits, retrieval.CitationOptions{Random: random})
	if err != nil {
		t.Fatal(err)
	}
	defer allowlist.Close()
	if allowlist.Len() != MaxEvidenceEntries || allowlist.entries[63].ModelID != "S64" {
		t.Fatalf("cap = %d %#v", allowlist.Len(), allowlist.entries[63])
	}
	if random.call != MaxEvidenceEntries {
		t.Fatalf("issued %d navigation citations beyond cap", random.call)
	}
	forgedTail := append([]retrieval.Hit(nil), result.Hits...)
	forgedTail[MaxEvidenceEntries].ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := NewEvidenceAllowlist(context.Background(), index, forgedTail, retrieval.CitationOptions{}); !errors.Is(err, retrieval.ErrUnsealedHit) {
		t.Fatalf("unvalidated candidate beyond evidence cap = %v", err)
	}
	extracted, err := allowlist.Extract("last [S64] outside [S65]")
	if err != nil || len(extracted.Citations) != 1 || extracted.OutOfRangeCount != 1 {
		t.Fatalf("extract = %#v %v", extracted, err)
	}
	tooMany := make([]retrieval.Hit, MaxEvidenceCandidates+1)
	if _, err := NewEvidenceAllowlist(context.Background(), index, tooMany, retrieval.CitationOptions{}); !errors.Is(err, ErrInvalidEvidenceInput) {
		t.Fatalf("raw cap = %v", err)
	}
}

func TestContextUsesRuneBudgetsAndExactEncodedByteBoundary(t *testing.T) {
	profile := chatProfile()
	profile.MaxInputChars = 1
	profile.MaxEvidenceChars = len([]rune(emptyEvidenceSystem()))
	request := providers.ProviderRequest{Model: profile.Model, System: emptyEvidenceSystem(), Turns: []providers.ChatMessage{{Role: "user", Content: "界"}}, MaxOutputTokens: profile.MaxOutputTokens}
	wire, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	built, err := (ContextBuilder{RequestByteLimit: len(wire)}).Build(BuildInput{Profile: profile, Question: "界"})
	if err != nil || built.Request.Turns[0].Content != "界" {
		t.Fatalf("exact boundary = %#v %v", built, err)
	}
	if _, err := (ContextBuilder{RequestByteLimit: len(wire) - 1}).Build(BuildInput{Profile: profile, Question: "界"}); !errors.Is(err, ErrContextBudget) {
		t.Fatalf("byte boundary = %v", err)
	}
	if _, err := (ContextBuilder{}).Build(BuildInput{Profile: profile, Question: "界界"}); !errors.Is(err, ErrInvalidContext) {
		t.Fatalf("rune boundary = %v", err)
	}
}

var _ io.Reader = (*distinctRandom)(nil)
