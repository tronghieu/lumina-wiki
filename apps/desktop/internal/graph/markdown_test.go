package graph

import "testing"

func TestParseMarkdownNote(t *testing.T) {
	raw := []byte("---\nid: ai\ntitle: AI\ntype: concept\ntags: [a, b]\n---\n\nBody text here.")
	note := parseMarkdownNote("wiki/concepts/ai.md", raw)

	if note.ID != "ai" || note.Title != "AI" || note.Type != "concept" {
		t.Fatalf("unexpected note: %#v", note)
	}
	if note.Preview != "Body text here." {
		t.Fatalf("unexpected preview: %q", note.Preview)
	}
}
