package retrieval

import "os"

const (
	PolicyVersion              = "lumina-corpus-v1"
	MaxFileBytes               = 2 * 1024 * 1024
	MaxCorpusFiles             = 4096
	MaxCorpusBytes             = 64 * 1024 * 1024
	MaxTraversalDepth          = 24
	MaxRelativePathBytes       = 4096
	MaxDirectoryEntries        = 4096
	MaxTraversalEntries        = 32768
	MaxWarnings                = 128
	FileVerificationReads      = 2
	MaxSnapshotAttempts        = 2
	MaxFileSnapshotReadBytes   = (MaxFileBytes + 1) * FileVerificationReads
	MaxCorpusSnapshotReadBytes = (MaxCorpusBytes + MaxCorpusFiles) * FileVerificationReads
	MaxSnapshotReadBytes       = MaxCorpusSnapshotReadBytes * MaxSnapshotAttempts
	ChunkVersion               = "lumina-chunk-v1"
	MaxChunkRunes              = 1200
	MaxChunkBytes              = 4800
	MaxChunkOverlapRunes       = 120
	MaxChunksPerDocument       = 2048
	MaxIndexChunks             = 32768
	MaxIndexTextBytes          = 64 * 1024 * 1024
	LexicalVersion             = "lumina-bm25-v1"
	BM25K1                     = 1.2
	BM25B                      = 0.75
	SelectedPathBoost          = 1.08
	LinkedPathBoost            = 1.04
	MaxQueryBytes              = 4096
	MaxSearchResults           = 100
	DefaultSearchResults       = 10
	MaxLinkedPaths             = 128
	MaxLinkedPathInputs        = 512
	MaxCitationsPerSession     = 512
	MaxCitationInputHits       = 1024 // Raw pre-deduplication session input bound.
	MaxCitationNoteBytes       = MaxFileBytes

	WarningChanged             = "file_changed"
	WarningInvalidUTF8         = "invalid_utf8"
	WarningOversize            = "file_too_large"
	WarningUnreadable          = "file_unreadable"
	WarningDirectoryChanged    = "directory_changed"
	WarningDirectoryUnreadable = "directory_unreadable"
	WarningInvalidPathEncoding = "invalid_path_encoding"
	WarningLimit               = "limit_reached"
	WarningStaleIndex          = "stale_index"
)

// Markdown extension and reserved-basename matching is bytewise and
// case-sensitive on every operating system for portable snapshots.

type Document struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	ContentHash string `json:"contentHash"`
	Size        int64  `json:"size"`
	identity    os.FileInfo
}

type Warning struct {
	Path string `json:"path"`
	Code string `json:"code"`
}

type Snapshot struct {
	Documents    []Document `json:"documents"`
	SnapshotHash string     `json:"snapshotHash"`
	Warnings     []Warning  `json:"warnings"`
	Truncated    bool       `json:"truncated"`
	rootIdentity os.FileInfo
}

type Chunk struct {
	ID           string `json:"id"`
	Path         string `json:"path"`
	Heading      string `json:"heading"`
	Text         string `json:"text"`
	ContentHash  string `json:"contentHash"`
	SnapshotHash string `json:"snapshotHash"`
	Start        int    `json:"start"`
	End          int    `json:"end"`
}

type SearchOptions struct {
	Limit        int      `json:"limit"`
	SelectedPath string   `json:"selectedPath"`
	LinkedPaths  []string `json:"linkedPaths"`
}

type Hit struct {
	Chunk
	Score         float64 `json:"score"`
	Rank          int     `json:"rank"`
	DocumentHash  string  `json:"-"`
	identity      os.FileInfo
	rootIdentity  os.FileInfo
	seal          *hitSeal
	sealedChunkID string
}

type SearchResult struct {
	Hits     []Hit     `json:"hits"`
	Warnings []Warning `json:"warnings"`
}
