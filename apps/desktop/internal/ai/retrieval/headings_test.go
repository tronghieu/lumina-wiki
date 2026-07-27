package retrieval

import (
	"context"
	"testing"
)

func TestChunkMarkdownSetextAndATXHeadingForms(t *testing.T) {
	doc := Document{Path: "wiki/headings.md", Content: "Title\n=====\n\nSubtitle\n---\n\nbody\n\n#\tTabbed\n\ntab body\n\n## Label ##\n\nclosed\n\n## Label#\n\nunclosed"}
	chunks, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ heading, text string }{
		{"Title > Subtitle", "body"},
		{"Tabbed", "tab body"},
		{"Tabbed > Label", "closed"},
		{"Tabbed > Label#", "unclosed"},
	}
	if len(chunks) != len(want) {
		t.Fatalf("chunks = %#v", chunks)
	}
	for i := range want {
		if chunks[i].Heading != want[i].heading || chunks[i].Text != want[i].text {
			t.Fatalf("chunk %d = %#v", i, chunks[i])
		}
	}
}

func TestChunkMarkdownDoesNotPromoteEscapedFencedOrIndentedHeadings(t *testing.T) {
	doc := Document{Path: "wiki/not-headings.md", Content: "\\# escaped\n\n####### seven\n\n```\nInside\n---\n# code\n```\n\n    Indented\n    ---"}
	chunks, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 4 {
		t.Fatalf("chunks = %#v", chunks)
	}
	for _, chunk := range chunks {
		if chunk.Heading != "" {
			t.Fatalf("false heading: %#v", chunk)
		}
	}
}

func TestSetextUnderlineAfterCodeBlockDoesNotPromoteCode(t *testing.T) {
	doc := Document{Path: "wiki/code-setext.md", Content: "```\ncode\n```\n---\n\n    indented code\n---"}
	chunks, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 2 {
		t.Fatalf("chunks = %#v", chunks)
	}
	for _, chunk := range chunks {
		if chunk.Heading != "" {
			t.Fatalf("code promoted: %#v", chunk)
		}
	}
}

func TestSetextHeadingFlowsThroughSearchAndCitation(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/note.md": "Setext Topic\n===\n\nneedle body"})
	result, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hits) != 1 || result.Hits[0].Heading != "Setext Topic" {
		t.Fatalf("hit = %#v", result.Hits)
	}
	reader, citations, err := NewCitationReader(context.Background(), index, result.Hits, CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	note, err := reader.ReadCitationNote(context.Background(), citations[0].ID)
	if err != nil || note.Heading != "Setext Topic" {
		t.Fatalf("note = %#v, %v", note, err)
	}
}
