package retrieval

import (
	"context"
	"math"
	"os"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

type lexicalDocument struct {
	chunk        Chunk
	documentHash string
	terms        map[string]int
	length       int
	identity     os.FileInfo
}

type hitSeal struct{ marker byte }

type Lexical struct {
	corpus            *Corpus
	root              string
	documents         []lexicalDocument
	documentFrequency map[string]int
	averageLength     float64
	rootIdentity      os.FileInfo
	snapshotHash      string
	byChunkID         map[string]lexicalDocument
	seal              *hitSeal
}

func BuildLexical(ctx context.Context, corpus *Corpus, root string) (*Lexical, error) {
	return buildLexical(ctx, corpus, root, nil, false)
}

func buildLexical(ctx context.Context, corpus *Corpus, root string, expected os.FileInfo, trusted bool) (*Lexical, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if corpus == nil {
		corpus = NewCorpus()
	}
	snapshot, err := corpus.Snapshot(ctx, root)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if trusted && (!snapshot.rootCurrent || !sameSnapshotRoot(expected, snapshot.rootIdentity)) {
		return nil, ErrWorkspaceIdentityChanged
	}
	if snapshot.Truncated {
		return nil, ErrLimitReached
	}
	if snapshot.rootIdentity == nil {
		return nil, ErrStaleIndex
	}
	index := &Lexical{corpus: corpus, root: root, rootIdentity: snapshot.rootIdentity, snapshotHash: snapshot.SnapshotHash,
		documentFrequency: map[string]int{}, byChunkID: map[string]lexicalDocument{}, seal: &hitSeal{marker: 1}}
	textBytes, totalTerms := 0, 0
	for _, document := range snapshot.Documents {
		if document.identity == nil {
			return nil, ErrStaleIndex
		}
		chunks, chunkErr := ChunkMarkdown(ctx, document, snapshot.SnapshotHash)
		if chunkErr != nil {
			return nil, chunkErr
		}
		for _, chunk := range chunks {
			if len(index.documents) >= MaxIndexChunks || textBytes+len(chunk.Text) > MaxIndexTextBytes {
				return nil, ErrLimitReached
			}
			terms := termCounts(tokenize(chunk.Text))
			indexed := lexicalDocument{chunk: chunk, documentHash: document.ContentHash, terms: terms, length: termTotal(terms), identity: document.identity}
			index.documents = append(index.documents, indexed)
			index.byChunkID[chunk.ID] = indexed
			for term := range terms {
				index.documentFrequency[term]++
			}
			textBytes += len(chunk.Text)
			totalTerms += termTotal(terms)
		}
	}
	if len(index.documents) > 0 {
		index.averageLength = float64(totalTerms) / float64(len(index.documents))
	}
	return index, nil
}

func tokenize(value string) []string {
	value = strings.ToLower(normalizeMarkdown(value))
	return strings.FieldsFunc(value, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
}

func termCounts(terms []string) map[string]int {
	counts := make(map[string]int, len(terms))
	for _, term := range terms {
		counts[term]++
	}
	return counts
}

func termTotal(terms map[string]int) int {
	total := 0
	for _, count := range terms {
		total += count
	}
	return total
}

func (index *Lexical) Search(ctx context.Context, query string, options SearchOptions) (SearchResult, error) {
	if err := ctx.Err(); err != nil {
		return SearchResult{}, err
	}
	if !utf8.ValidString(query) || len(query) > MaxQueryBytes {
		return SearchResult{}, ErrLimitReached
	}
	limit, selected, linked, err := normalizeSearchOptions(options)
	if err != nil {
		return SearchResult{}, err
	}
	queryTerms := termCounts(tokenize(query))
	snapshot, err := index.currentGeneration(ctx)
	if err != nil {
		return SearchResult{}, err
	}
	if len(queryTerms) == 0 {
		return SearchResult{Hits: []Hit{}, Warnings: []Warning{}}, nil
	}
	orderedTerms := make([]string, 0, len(queryTerms))
	for term := range queryTerms {
		orderedTerms = append(orderedTerms, term)
	}
	sort.Strings(orderedTerms)
	candidates := make([]Hit, 0)
	for _, document := range index.documents {
		if err := ctx.Err(); err != nil {
			return SearchResult{}, err
		}
		score := index.score(document, queryTerms, orderedTerms)
		if score <= 0 {
			continue
		}
		if document.chunk.Path == selected {
			score *= SelectedPathBoost
		} else if linked[document.chunk.Path] {
			score *= LinkedPathBoost
		}
		candidates = append(candidates, index.sealHit(document, score))
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		if candidates[i].Path != candidates[j].Path {
			return candidates[i].Path < candidates[j].Path
		}
		return candidates[i].ID < candidates[j].ID
	})
	return index.freshHits(ctx, snapshot, candidates, limit)
}

func (index *Lexical) sealHit(document lexicalDocument, score float64) Hit {
	return Hit{Chunk: document.chunk, Score: score, DocumentHash: document.documentHash,
		identity: document.identity, rootIdentity: index.rootIdentity, seal: index.seal, sealedChunkID: document.chunk.ID}
}

func (index *Lexical) score(document lexicalDocument, query map[string]int, orderedTerms []string) float64 {
	if index.averageLength == 0 {
		return 0
	}
	n := float64(len(index.documents))
	score := 0.0
	for _, term := range orderedTerms {
		queryFrequency := query[term]
		tf := float64(document.terms[term])
		if tf == 0 {
			continue
		}
		df := float64(index.documentFrequency[term])
		idf := math.Log(1 + (n-df+0.5)/(df+0.5))
		denominator := tf + BM25K1*(1-BM25B+BM25B*float64(document.length)/index.averageLength)
		score += float64(queryFrequency) * idf * tf * (BM25K1 + 1) / denominator
	}
	return score
}
