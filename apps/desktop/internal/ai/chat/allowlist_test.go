package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func testIndex(t *testing.T, notes map[string]string) (*retrieval.Lexical, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# workspace"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatal(err)
	}
	for name, content := range notes {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	index, err := retrieval.BuildLexical(context.Background(), retrieval.NewCorpus(), root)
	if err != nil {
		t.Fatal(err)
	}
	return index, root
}

func TestAllowlistUsesSealedHitsDeduplicatesAndKeepsNavigationOpaque(t *testing.T) {
	index, _ := testIndex(t, map[string]string{"wiki/custom/note.md": "# Heading\n\nneedle evidence"})
	result, err := index.Search(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	hits := append(result.Hits, result.Hits[0])
	allowlist, err := NewEvidenceAllowlist(context.Background(), index, hits, retrieval.CitationOptions{Random: bytes.NewReader(bytes.Repeat([]byte{0x2a}, 32))})
	if err != nil {
		t.Fatal(err)
	}
	defer allowlist.Close()
	if allowlist.Len() != 1 || allowlist.entries[0].ModelID != "S1" {
		t.Fatalf("entries = %#v", allowlist.entries)
	}
	dtos, err := allowlist.Resolve([]string{"S1", "S1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(dtos) != 1 || dtos[0].CitationID != "cit_2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a" || dtos[0].Path != "wiki/custom/note.md" || dtos[0].Heading != "Heading" {
		t.Fatalf("DTOs = %#v", dtos)
	}
	wire, _ := json.Marshal(dtos[0])
	if strings.Contains(string(wire), result.Hits[0].ID) || strings.Contains(string(wire), "contentHash") {
		t.Fatalf("wire leak: %s", wire)
	}
}

func TestAllowlistRejectsUnsealedForeignUnknownAndClosedResolution(t *testing.T) {
	indexA, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	indexB, _ := testIndex(t, map[string]string{"wiki/b.md": "needle"})
	result, _ := indexA.Search(context.Background(), "needle", retrieval.SearchOptions{})
	if _, err := NewEvidenceAllowlist(context.Background(), indexB, result.Hits, retrieval.CitationOptions{}); !errors.Is(err, retrieval.ErrForeignHit) {
		t.Fatalf("foreign = %v", err)
	}
	forged := append([]retrieval.Hit(nil), result.Hits...)
	forged[0].ID = strings.Repeat("a", 64)
	if _, err := NewEvidenceAllowlist(context.Background(), indexA, forged, retrieval.CitationOptions{}); !errors.Is(err, retrieval.ErrUnsealedHit) {
		t.Fatalf("forged = %v", err)
	}
	allowlist, err := NewEvidenceAllowlist(context.Background(), indexA, result.Hits, retrieval.CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := allowlist.Resolve([]string{"S2"}); !errors.Is(err, ErrUnknownEvidence) {
		t.Fatalf("unknown = %v", err)
	}
	allowlist.Close()
	if _, err := allowlist.Resolve([]string{"S1"}); !errors.Is(err, ErrEvidenceClosed) {
		t.Fatalf("closed = %v", err)
	}
}

func TestExtractCitationsCanonicalDeduplicatedAndBounded(t *testing.T) {
	index, _ := testIndex(t, map[string]string{"wiki/a.md": "needle"})
	result, _ := index.Search(context.Background(), "needle", retrieval.SearchOptions{})
	allowlist, err := NewEvidenceAllowlist(context.Background(), index, result.Hits, retrieval.CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer allowlist.Close()
	extracted, err := allowlist.Extract("answer [S1] again [S1] unknown [S2] [S2] malformed [S01] [S01] [S999] [S999] [s1]")
	if err != nil {
		t.Fatal(err)
	}
	if len(extracted.Citations) != 1 || extracted.ValidCount != 1 || extracted.UnknownCount != 1 || extracted.MalformedCount != 2 || extracted.OutOfRangeCount != 1 {
		t.Fatalf("extracted = %#v", extracted)
	}
	if _, err := allowlist.Extract(strings.Repeat("x", MaxAssistantCitationBytes+1)); !errors.Is(err, ErrInvalidAssistantText) {
		t.Fatalf("oversize = %v", err)
	}
}
