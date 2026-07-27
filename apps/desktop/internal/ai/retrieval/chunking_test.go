package retrieval

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestStripFrontmatterDelimitedLinesOnly(t *testing.T) {
	valid := "---\r\ntitle: Example\r\n---\r\n# Heading\r\n\r\nBody"
	if got := StripFrontmatter(valid); got != "# Heading\n\nBody" {
		t.Fatalf("valid frontmatter = %q", got)
	}
	unclosed := "---\ntitle: Example\n# Heading\nBody"
	if got := StripFrontmatter(unclosed); got != unclosed {
		t.Fatalf("unclosed frontmatter was stripped: %q", got)
	}
	inline := "--- not a delimiter\nBody"
	if got := StripFrontmatter(inline); got != inline {
		t.Fatalf("inline delimiter changed: %q", got)
	}
}

func TestChunkMarkdownNormalizesAndInheritsHeading(t *testing.T) {
	doc := Document{Path: "wiki/custom/note.md", Content: "---\nid: x\n---\n# Café\r\n\r\nFirst   paragraph.\r\n\r\nSecond paragraph.", ContentHash: "document"}
	chunks, err := ChunkMarkdown(context.Background(), doc, "snapshot")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 2 || chunks[0].Heading != "Café" || chunks[1].Heading != "Café" {
		t.Fatalf("chunks = %#v", chunks)
	}
	if chunks[0].Text != "First   paragraph." || chunks[0].SnapshotHash != "snapshot" {
		t.Fatalf("first chunk = %#v", chunks[0])
	}
	for _, chunk := range chunks {
		if chunk.Start < 0 || chunk.End <= chunk.Start || chunk.ID == "" || chunk.ContentHash == "" {
			t.Fatalf("invalid chunk = %#v", chunk)
		}
	}
}

func TestChunkMarkdownPreservesFencedCodeVerbatim(t *testing.T) {
	doc := Document{Path: "wiki/code.md", Content: "# Outer\n\n````go\n# not a heading\n\nvalue  :=  `a  b`\n```\n````\n\n~~~python\n# still code\n\nprint(\"x\")\n~~~\n\n## Real\n\nprose"}
	chunks, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 3 {
		t.Fatalf("chunks = %#v", chunks)
	}
	wantFirst := "````go\n# not a heading\n\nvalue  :=  `a  b`\n```\n````"
	wantSecond := "~~~python\n# still code\n\nprint(\"x\")\n~~~"
	if chunks[0].Heading != "Outer" || chunks[0].Text != wantFirst || chunks[1].Text != wantSecond || chunks[2].Heading != "Outer > Real" {
		t.Fatalf("fence parsing changed Markdown: %#v", chunks)
	}
}

func TestChunkMarkdownPreservesIndentedAndInlineCodeSpaces(t *testing.T) {
	doc := Document{Path: "wiki/spaces.md", Content: "    indented  code\n    # not a heading\n    second line\n\nUse `a  b` and ``c   d`` exactly.  "}
	chunks, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 2 || chunks[0].Text != "    indented  code\n    # not a heading\n    second line" || chunks[1].Text != "Use `a  b` and ``c   d`` exactly.  " {
		t.Fatalf("code whitespace changed: %#v", chunks)
	}
}

func TestChunkMarkdownUnclosedFenceIsDeterministicBody(t *testing.T) {
	doc := Document{Path: "wiki/unclosed.md", Content: "# Heading\n\n```text\n# code\n\nbody"}
	a, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	b, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, b) || len(a) != 1 || a[0].Text != "```text\n# code\n\nbody" || a[0].Heading != "Heading" {
		t.Fatalf("unclosed fence = %#v %#v", a, b)
	}
}

func TestChunkMarkdownLongFenceSplitPreservesNormalizedBytes(t *testing.T) {
	body := "```text\n" + strings.Repeat("界", MaxChunkRunes+200) + "\n```"
	chunks, err := ChunkMarkdown(context.Background(), Document{Path: "wiki/long-code.md", Content: body}, "s")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) < 2 {
		t.Fatalf("chunks = %d", len(chunks))
	}
	rebuilt := chunks[0].Text
	for _, chunk := range chunks[1:] {
		runes := []rune(chunk.Text)
		overlap := MaxChunkOverlapRunes
		if overlap > len(runes) {
			overlap = len(runes)
		}
		rebuilt += string(runes[overlap:])
	}
	if rebuilt != body {
		t.Fatal("long fenced code bytes changed")
	}
}

func TestChunkMarkdownNFCAndContentHashAreDeterministic(t *testing.T) {
	composed := Document{Path: "wiki/a.md", Content: "# Café\n\nRésumé"}
	decomposed := Document{Path: "wiki/a.md", Content: "# Cafe\u0301\n\nRe\u0301sume\u0301"}
	a, err := ChunkMarkdown(context.Background(), composed, "s")
	if err != nil {
		t.Fatal(err)
	}
	b, err := ChunkMarkdown(context.Background(), decomposed, "s")
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 1 || len(b) != 1 || a[0].Text != b[0].Text || a[0].ID != b[0].ID {
		t.Fatalf("normalization differs: %#v %#v", a, b)
	}
	otherPath := composed
	otherPath.Path = "wiki/b.md"
	c, err := ChunkMarkdown(context.Background(), otherPath, "s")
	if err != nil {
		t.Fatal(err)
	}
	if a[0].ContentHash != c[0].ContentHash || a[0].ID == c[0].ID {
		t.Fatalf("hash/ID path contract violated: %#v %#v", a[0], c[0])
	}
}

func TestChunkMarkdownSplitsLongUnicodeSafelyWithBoundedOverlap(t *testing.T) {
	doc := Document{Path: "wiki/long.md", Content: strings.Repeat("界", MaxChunkRunes+200)}
	chunks, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) < 2 {
		t.Fatalf("chunks = %d", len(chunks))
	}
	for _, chunk := range chunks {
		if !utf8.ValidString(chunk.Text) || utf8.RuneCountInString(chunk.Text) > MaxChunkRunes || len(chunk.Text) > MaxChunkBytes {
			t.Fatalf("unsafe chunk size: bytes=%d runes=%d", len(chunk.Text), utf8.RuneCountInString(chunk.Text))
		}
	}
	if overlap := chunks[0].End - chunks[1].Start; overlap != MaxChunkOverlapRunes {
		t.Fatalf("overlap = %d", overlap)
	}
}

func TestChunkMarkdownEmptyCapAndCancellation(t *testing.T) {
	for _, content := range []string{"", "---\nid: x\n---\n"} {
		chunks, err := ChunkMarkdown(context.Background(), Document{Path: "wiki/a.md", Content: content}, "s")
		if err != nil || len(chunks) != 0 {
			t.Fatalf("empty = %#v, %v", chunks, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ChunkMarkdown(ctx, Document{Path: "wiki/a.md", Content: "body"}, "s"); err != context.Canceled {
		t.Fatalf("cancel = %v", err)
	}
	doc := Document{Path: "wiki/cap.md", Content: strings.Repeat("paragraph\n\n", MaxChunksPerDocument+1)}
	if _, err := ChunkMarkdown(context.Background(), doc, "s"); err != ErrLimitReached {
		t.Fatalf("cap = %v", err)
	}
	oversize := Document{Path: "wiki/large.md", Content: strings.Repeat("x", MaxFileBytes+1)}
	if _, err := ChunkMarkdown(context.Background(), oversize, "s"); err != ErrLimitReached {
		t.Fatalf("text cap = %v", err)
	}
}

func TestChunkMarkdownPreservesMeaningfulMarkdownLineBreaks(t *testing.T) {
	doc := Document{Path: "wiki/meaning.md", Content: "- first item\n- second item\n\nfirst line  \nsecond line"}
	chunks, err := ChunkMarkdown(context.Background(), doc, "s")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 2 || chunks[0].Text != "- first item\n- second item" || chunks[1].Text != "first line  \nsecond line" {
		t.Fatalf("markdown meaning changed: %#v", chunks)
	}
}
