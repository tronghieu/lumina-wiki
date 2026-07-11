package retrieval

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

var ErrLimitReached = errors.New("retrieval limit reached")

func normalizeMarkdown(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return norm.NFC.String(value)
}

func StripFrontmatter(markdown string) string {
	markdown = normalizeMarkdown(markdown)
	lines := strings.Split(markdown, "\n")
	if len(lines) == 0 || lines[0] != "---" {
		return markdown
	}
	for index := 1; index < len(lines); index++ {
		if lines[index] == "---" {
			return trimBlankBoundaryLines(strings.Join(lines[index+1:], "\n"))
		}
	}
	return markdown
}

func ContentHash(text string) string {
	sum := sha256.Sum256([]byte(normalizeMarkdown(text)))
	return hex.EncodeToString(sum[:])
}

func ChunkID(path string, start, end int, contentHash string) string {
	value := ChunkVersion + "\x00" + path + "\x00" + strconv.Itoa(start) + ":" + strconv.Itoa(end) + "\x00" + contentHash
	return ContentHash(value)
}

type markdownPart struct{ heading, text string }

func markdownParts(body string) []markdownPart {
	var parts []markdownPart
	headings := make([]string, 6)
	var paragraph []string
	paragraphCode := false
	var fence rune
	fenceLength := 0
	flush := func() {
		text := strings.Join(paragraph, "\n")
		if text != "" {
			var active []string
			for _, heading := range headings {
				if heading != "" {
					active = append(active, heading)
				}
			}
			parts = append(parts, markdownPart{strings.Join(active, " > "), text})
		}
		paragraph = nil
		paragraphCode = false
	}
	setHeading := func(level int, title string) {
		headings[level-1] = title
		for index := level; index < len(headings); index++ {
			headings[index] = ""
		}
	}
	for _, line := range strings.Split(body, "\n") {
		if fence != 0 {
			paragraph = append(paragraph, line)
			if isFenceClose(line, fence, fenceLength) {
				fence, fenceLength = 0, 0
			}
			continue
		}
		if level := setextHeadingLevel(line); level > 0 && len(paragraph) > 0 && !paragraphCode {
			title := normalizeSetextLabel(paragraph)
			paragraph = nil
			paragraphCode = false
			setHeading(level, title)
			continue
		}
		trimmed := strings.TrimSpace(line)
		level, title := markdownHeading(line)
		if level > 0 {
			flush()
			setHeading(level, title)
		} else if trimmed == "" {
			flush()
		} else {
			paragraph = append(paragraph, line)
			if isIndentedCode(line) {
				paragraphCode = true
			}
			if marker, length, ok := fenceOpen(line); ok {
				fence, fenceLength = marker, length
				paragraphCode = true
			}
		}
	}
	flush()
	return parts
}

func trimBlankBoundaryLines(value string) string {
	lines := strings.Split(value, "\n")
	start, end := 0, len(lines)
	for start < end && strings.TrimSpace(lines[start]) == "" {
		start++
	}
	for end > start && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	return strings.Join(lines[start:end], "\n")
}

func ChunkMarkdown(ctx context.Context, document Document, snapshotHash string) ([]Chunk, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(document.Content) > MaxFileBytes || !utf8.ValidString(document.Content) {
		return nil, ErrLimitReached
	}
	body := StripFrontmatter(document.Content)
	if strings.TrimSpace(body) == "" {
		return []Chunk{}, nil
	}
	chunks := make([]Chunk, 0)
	position := 0
	for _, part := range markdownParts(body) {
		for pieceIndex, text := range splitChunkText(part.text) {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if len(chunks) >= MaxChunksPerDocument {
				return nil, ErrLimitReached
			}
			start := position
			if pieceIndex > 0 {
				start -= MaxChunkOverlapRunes
			}
			end := start + utf8.RuneCountInString(text)
			hash := ContentHash(text)
			chunks = append(chunks, Chunk{ID: ChunkID(document.Path, start, end, hash), Path: document.Path,
				Heading: part.heading, Text: text, ContentHash: hash, SnapshotHash: snapshotHash, Start: start, End: end})
			position = end
		}
	}
	return chunks, nil
}

func splitChunkText(text string) []string {
	runes := []rune(text)
	if len(runes) <= MaxChunkRunes && len(text) <= MaxChunkBytes {
		return []string{text}
	}
	var result []string
	for start := 0; start < len(runes); {
		end := start + MaxChunkRunes
		if end > len(runes) {
			end = len(runes)
		}
		for end > start && len(string(runes[start:end])) > MaxChunkBytes {
			end--
		}
		if end == start {
			end++
		}
		result = append(result, string(runes[start:end]))
		if end == len(runes) {
			break
		}
		start = end - MaxChunkOverlapRunes
		if start < 0 {
			start = 0
		}
	}
	return result
}
