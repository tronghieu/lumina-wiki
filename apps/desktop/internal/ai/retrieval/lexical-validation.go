package retrieval

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

func normalizeSearchOptions(options SearchOptions) (int, string, map[string]bool, error) {
	if len(options.LinkedPaths) > MaxLinkedPathInputs {
		return 0, "", nil, ErrLimitReached
	}
	limit := options.Limit
	if limit == 0 {
		limit = DefaultSearchResults
	}
	if limit < 0 || limit > MaxSearchResults {
		return 0, "", nil, ErrLimitReached
	}
	selected, ok := normalizedCorpusPath(options.SelectedPath)
	if !ok && options.SelectedPath != "" {
		return 0, "", nil, ErrLimitReached
	}
	linked := make(map[string]bool)
	for _, raw := range options.LinkedPaths {
		path, valid := normalizedCorpusPath(raw)
		if !valid {
			return 0, "", nil, ErrLimitReached
		}
		linked[path] = true
	}
	if len(linked) > MaxLinkedPaths {
		return 0, "", nil, ErrLimitReached
	}
	return limit, selected, linked, nil
}

func normalizedCorpusPath(path string) (string, bool) {
	if path == "" {
		return "", true
	}
	if !utf8.ValidString(path) || len(path) > MaxRelativePathBytes || strings.Contains(path, "\\") {
		return "", false
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(path)))
	if clean != path || !strings.HasPrefix(path, "wiki/") || !strings.HasSuffix(path, ".md") {
		return "", false
	}
	for _, part := range strings.Split(path, "/") {
		if part == "" || part == "." || part == ".." {
			return "", false
		}
	}
	return path, true
}

func (index *Lexical) freshHits(ctx context.Context, snapshot Snapshot, candidates []Hit, limit int) (SearchResult, error) {
	result := SearchResult{Hits: []Hit{}, Warnings: []Warning{}}
	if limit == 0 {
		return result, nil
	}
	current := make(map[string]Document, len(snapshot.Documents))
	for _, document := range snapshot.Documents {
		current[document.Path] = document
	}
	warned := map[string]bool{}
	chunkCache := map[string][]Chunk{}
	for _, hit := range candidates {
		if err := ctx.Err(); err != nil {
			return SearchResult{}, err
		}
		document, ok := current[hit.Path]
		if !ok || document.ContentHash == "" || document.ContentHash != hit.DocumentHash || !sameSnapshotFile(hit.identity, document.identity) {
			addStaleWarning(&result, warned, hit.Path)
			continue
		}
		chunks, cached := chunkCache[hit.Path]
		if !cached {
			var chunkErr error
			chunks, chunkErr = ChunkMarkdown(ctx, document, snapshot.SnapshotHash)
			if chunkErr != nil {
				return SearchResult{}, chunkErr
			}
			chunkCache[hit.Path] = chunks
		}
		fresh, found := findEquivalentChunk(chunks, hit.Chunk)
		if !found {
			addStaleWarning(&result, warned, hit.Path)
			continue
		}
		hit.Chunk = fresh
		hit.Rank = len(result.Hits) + 1
		result.Hits = append(result.Hits, hit)
		if len(result.Hits) == limit {
			break
		}
	}
	sort.Slice(result.Warnings, func(i, j int) bool { return result.Warnings[i].Path < result.Warnings[j].Path })
	return result, nil
}

func sameSnapshotRoot(expected, current os.FileInfo) bool {
	return expected != nil && current != nil && expected.IsDir() && current.IsDir() && os.SameFile(expected, current)
}

func findEquivalentChunk(chunks []Chunk, expected Chunk) (Chunk, bool) {
	for _, chunk := range chunks {
		if chunk.ID == expected.ID && chunk.ContentHash == expected.ContentHash {
			return chunk, true
		}
	}
	return Chunk{}, false
}

func addStaleWarning(result *SearchResult, warned map[string]bool, path string) {
	if !warned[path] && len(result.Warnings) < MaxWarnings {
		result.Warnings = append(result.Warnings, Warning{Path: path, Code: WarningStaleIndex})
		warned[path] = true
	}
}
