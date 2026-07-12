package chat

import (
	"context"
	"errors"
	"sync"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

const (
	MaxEvidenceEntries        = 64
	MaxEvidenceCandidates     = retrieval.MaxCitationInputHits
	MaxEvidenceIDBytes        = 4
	MaxAssistantCitationBytes = 256 * 1024
)

var (
	ErrEvidenceClosed       = errors.New("evidence allowlist closed")
	ErrUnknownEvidence      = errors.New("unknown evidence ID")
	ErrInvalidEvidenceInput = errors.New("invalid evidence input")
	ErrInvalidAssistantText = errors.New("invalid assistant text")
)

type CitationDTO struct {
	ModelID    string `json:"modelId"`
	CitationID string `json:"citationId"`
	Path       string `json:"path"`
	Heading    string `json:"heading"`
	Start      int    `json:"start"`
	End        int    `json:"end"`
}

type CitationExtraction struct {
	Citations       []CitationDTO `json:"citations"`
	ValidCount      int           `json:"validCount"`
	UnknownCount    int           `json:"unknownCount"`
	MalformedCount  int           `json:"malformedCount"`
	OutOfRangeCount int           `json:"outOfRangeCount"`
}

type evidenceEntry struct {
	ModelID, CitationID, ChunkID string
	Path, Heading, Text          string
	Start, End                   int
}

type EvidenceAllowlist struct {
	mu      sync.RWMutex
	reader  citationNoteReader
	entries []evidenceEntry
	byID    map[string]evidenceEntry
	closed  bool
}

type citationNoteReader interface {
	ReadCitationNote(context.Context, string) (retrieval.CitationNote, error)
	Close()
}

func NewEvidenceAllowlist(ctx context.Context, index *retrieval.Lexical, hits []retrieval.Hit, options retrieval.CitationOptions) (*EvidenceAllowlist, error) {
	if len(hits) > MaxEvidenceCandidates {
		return nil, ErrInvalidEvidenceInput
	}
	options.MaxCitations = MaxEvidenceEntries
	reader, citations, err := retrieval.NewCitationReader(ctx, index, hits, options)
	if err != nil {
		return nil, err
	}
	limit := len(citations)
	allowlist := &EvidenceAllowlist{reader: reader, byID: make(map[string]evidenceEntry, limit), entries: make([]evidenceEntry, 0, limit)}
	for i, citation := range citations[:limit] {
		chunk := citation.Chunk
		entry := evidenceEntry{ModelID: modelEvidenceID(i + 1), CitationID: citation.ID, ChunkID: citation.ChunkID,
			Path: chunk.Path, Heading: chunk.Heading, Text: chunk.Text, Start: chunk.Start, End: chunk.End}
		allowlist.entries = append(allowlist.entries, entry)
		allowlist.byID[entry.ModelID] = entry
	}
	return allowlist, nil
}

func modelEvidenceID(number int) string {
	if number < 10 {
		return string([]byte{'S', byte('0' + number)})
	}
	return string([]byte{'S', byte('0' + number/10), byte('0' + number%10)})
}

func (allowlist *EvidenceAllowlist) Len() int {
	allowlist.mu.RLock()
	defer allowlist.mu.RUnlock()
	if allowlist.closed {
		return 0
	}
	return len(allowlist.entries)
}

func (allowlist *EvidenceAllowlist) Close() {
	allowlist.mu.Lock()
	if !allowlist.closed {
		allowlist.closed = true
		allowlist.reader.Close()
		allowlist.entries = nil
		allowlist.byID = nil
	}
	allowlist.mu.Unlock()
}

func (allowlist *EvidenceAllowlist) Resolve(ids []string) ([]CitationDTO, error) {
	allowlist.mu.RLock()
	defer allowlist.mu.RUnlock()
	if allowlist.closed {
		return nil, ErrEvidenceClosed
	}
	if len(ids) > MaxEvidenceEntries {
		return nil, ErrInvalidEvidenceInput
	}
	result, seen := make([]CitationDTO, 0, len(ids)), map[string]bool{}
	for _, id := range ids {
		if len(id) > MaxEvidenceIDBytes {
			return nil, ErrUnknownEvidence
		}
		entry, ok := allowlist.byID[id]
		if !ok {
			return nil, ErrUnknownEvidence
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, entry.dto())
	}
	return result, nil
}

func (entry evidenceEntry) dto() CitationDTO {
	return CitationDTO{ModelID: entry.ModelID, CitationID: entry.CitationID, Path: entry.Path, Heading: entry.Heading, Start: entry.Start, End: entry.End}
}

func (allowlist *EvidenceAllowlist) ReadCitationNote(ctx context.Context, citationID string) (retrieval.CitationNote, error) {
	allowlist.mu.RLock()
	if allowlist.closed {
		allowlist.mu.RUnlock()
		return retrieval.CitationNote{}, ErrEvidenceClosed
	}
	reader := allowlist.reader
	allowlist.mu.RUnlock()
	return reader.ReadCitationNote(ctx, citationID)
}

func validAssistantText(value string) bool {
	return utf8.ValidString(value) && len(value) <= MaxAssistantCitationBytes
}
