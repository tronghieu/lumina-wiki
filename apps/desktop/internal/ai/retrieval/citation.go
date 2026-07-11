package retrieval

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"regexp"
	"sync"
)

var (
	ErrMalformedCitation = errors.New("malformed citation ID")
	ErrUnknownCitation   = errors.New("unknown citation ID")
	ErrDuplicateCitation = errors.New("duplicate citation ID")
	ErrStaleIndex        = errors.New("stale_index")
	ErrCitationClosed    = errors.New("citation session closed")
)

var citationPattern = regexp.MustCompile(`^cit_[0-9a-f]{32}$`)

type CitationOptions struct{ Random io.Reader }

type Citation struct {
	ID      string `json:"id"`
	Heading string `json:"heading"`
}

type CitationNote struct {
	Path        string `json:"path"`
	Heading     string `json:"heading"`
	Content     string `json:"content"`
	ContentHash string `json:"contentHash"`
}

type citationEntry struct {
	chunk        Chunk
	documentHash string
	identity     os.FileInfo
	rootIdentity os.FileInfo
}

type CitationReader struct {
	mu      sync.RWMutex
	index   *Lexical
	entries map[string]citationEntry
	closed  bool
}

func NewCitationReader(ctx context.Context, index *Lexical, hits []Hit, options CitationOptions) (*CitationReader, []Citation, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if len(hits) > MaxCitationInputHits {
		return nil, nil, ErrLimitReached
	}
	if index == nil {
		return nil, nil, ErrUnsealedHit
	}
	for _, hit := range hits {
		if len(hit.ID) != 64 || !chunkIDPattern.MatchString(hit.ID) || hit.seal == nil || hit.sealedChunkID != hit.ID {
			return nil, nil, ErrUnsealedHit
		}
		if hit.seal != index.seal {
			return nil, nil, ErrForeignHit
		}
	}
	unique := make([]Hit, 0, len(hits))
	seenChunks := map[string]bool{}
	for _, hit := range hits {
		if seenChunks[hit.ID] {
			continue
		}
		seenChunks[hit.ID] = true
		if len(seenChunks) > MaxCitationsPerSession {
			return nil, nil, ErrLimitReached
		}
		unique = append(unique, hit)
	}
	snapshot, err := index.currentGeneration(ctx)
	if err != nil {
		return nil, nil, err
	}
	fresh, err := index.freshHits(ctx, snapshot, unique, len(unique))
	if err != nil {
		return nil, nil, err
	}
	if len(fresh.Hits) != len(unique) {
		return nil, nil, ErrStaleIndex
	}
	random := options.Random
	if random == nil {
		random = rand.Reader
	}
	reader := &CitationReader{index: index, entries: map[string]citationEntry{}}
	citations := make([]Citation, 0, len(fresh.Hits))
	for _, hit := range fresh.Hits {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		id, err := randomCitationID(random)
		if err != nil {
			return nil, nil, ErrDuplicateCitation
		}
		if _, exists := reader.entries[id]; exists {
			return nil, nil, ErrDuplicateCitation
		}
		reader.entries[id] = citationEntry{chunk: hit.Chunk, documentHash: hit.DocumentHash, identity: hit.identity, rootIdentity: hit.rootIdentity}
		citations = append(citations, Citation{ID: id, Heading: hit.Heading})
	}
	return reader, citations, nil
}

func randomCitationID(random io.Reader) (string, error) {
	value := make([]byte, 16)
	if _, err := io.ReadFull(random, value); err != nil {
		return "", err
	}
	return "cit_" + hex.EncodeToString(value), nil
}

func (reader *CitationReader) ReadCitationNote(ctx context.Context, citationID string) (CitationNote, error) {
	if err := ctx.Err(); err != nil {
		return CitationNote{}, err
	}
	if !citationPattern.MatchString(citationID) {
		return CitationNote{}, ErrMalformedCitation
	}
	reader.mu.RLock()
	if reader.closed {
		reader.mu.RUnlock()
		return CitationNote{}, ErrCitationClosed
	}
	entry, ok := reader.entries[citationID]
	reader.mu.RUnlock()
	if !ok {
		return CitationNote{}, ErrUnknownCitation
	}
	snapshot, err := reader.index.currentGeneration(ctx)
	if err != nil {
		return CitationNote{}, err
	}
	if reader.isClosed() {
		return CitationNote{}, ErrCitationClosed
	}
	for _, document := range snapshot.Documents {
		if document.Path != entry.chunk.Path {
			continue
		}
		if document.ContentHash != entry.documentHash || !sameSnapshotFile(entry.identity, document.identity) || len(document.Content) > MaxCitationNoteBytes {
			return CitationNote{}, ErrStaleIndex
		}
		chunks, chunkErr := ChunkMarkdown(ctx, document, snapshot.SnapshotHash)
		if chunkErr != nil {
			return CitationNote{}, chunkErr
		}
		fresh, found := findEquivalentChunk(chunks, entry.chunk)
		if !found {
			return CitationNote{}, ErrStaleIndex
		}
		if reader.isClosed() {
			return CitationNote{}, ErrCitationClosed
		}
		return CitationNote{Path: document.Path, Heading: fresh.Heading, Content: document.Content, ContentHash: document.ContentHash}, nil
	}
	return CitationNote{}, ErrStaleIndex
}

func (reader *CitationReader) isClosed() bool {
	reader.mu.RLock()
	defer reader.mu.RUnlock()
	return reader.closed
}

func (reader *CitationReader) Close() {
	reader.mu.Lock()
	defer reader.mu.Unlock()
	reader.closed = true
	reader.entries = nil
}
