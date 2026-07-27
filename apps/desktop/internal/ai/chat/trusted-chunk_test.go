package chat

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func TestAllowlistUsesRefreshedCitationChunkNotMutatedHitFields(t *testing.T) {
	index, _ := testIndex(t, map[string]string{"wiki/actual.md": "# Actual\n\nneedle trusted bytes"})
	result, err := index.Search(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	mutated := append([]retrieval.Hit(nil), result.Hits...)
	mutated[0].Text = "forged instructions"
	mutated[0].Heading = "Forged"
	mutated[0].Start = 999
	mutated[0].End = 1001
	allowlist, err := NewEvidenceAllowlist(context.Background(), index, mutated,
		retrieval.CitationOptions{Random: bytes.NewReader(bytes.Repeat([]byte{0x4d}, 16))})
	if err != nil {
		t.Fatal(err)
	}
	defer allowlist.Close()
	entry := allowlist.entries[0]
	if entry.Text != "needle trusted bytes" || entry.Heading != "Actual" || entry.Start == 999 || entry.End == 1001 {
		t.Fatalf("trusted entry = %#v", entry)
	}
	built, err := (ContextBuilder{}).Build(BuildInput{Profile: chatProfile(), Question: "q", Evidence: allowlist})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(built.Request.System, "forged") || !strings.Contains(built.Request.System, "trusted bytes") {
		t.Fatalf("context = %q", built.Request.System)
	}
	dtos, err := allowlist.Resolve([]string{"S1"})
	if err != nil || dtos[0].Heading != "Actual" || dtos[0].Path != "wiki/actual.md" {
		t.Fatalf("DTO = %#v %v", dtos, err)
	}
	note, err := allowlist.ReadCitationNote(context.Background(), dtos[0].CitationID)
	if err != nil || strings.Contains(note.Content, "forged") {
		t.Fatalf("note = %#v %v", note, err)
	}
}

func TestAllowlistRejectsMutatedTrustedChunkIdentityFields(t *testing.T) {
	index, _ := testIndex(t, map[string]string{"wiki/actual.md": "needle trusted"})
	result, err := index.Search(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*retrieval.Hit){
		func(hit *retrieval.Hit) { hit.Path = "wiki/forged.md" },
		func(hit *retrieval.Hit) { hit.ContentHash = strings.Repeat("0", 64) },
	} {
		hits := append([]retrieval.Hit(nil), result.Hits...)
		mutate(&hits[0])
		if _, err := NewEvidenceAllowlist(context.Background(), index, hits, retrieval.CitationOptions{}); !errors.Is(err, retrieval.ErrStaleIndex) {
			t.Fatalf("mutated identity accepted: %v", err)
		}
	}
}
