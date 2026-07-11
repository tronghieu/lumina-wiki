package retrieval

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

	WarningChanged             = "file_changed"
	WarningInvalidUTF8         = "invalid_utf8"
	WarningOversize            = "file_too_large"
	WarningUnreadable          = "file_unreadable"
	WarningDirectoryChanged    = "directory_changed"
	WarningDirectoryUnreadable = "directory_unreadable"
	WarningInvalidPathEncoding = "invalid_path_encoding"
	WarningLimit               = "limit_reached"
)

// Markdown extension and reserved-basename matching is bytewise and
// case-sensitive on every operating system for portable snapshots.

type Document struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	ContentHash string `json:"contentHash"`
	Size        int64  `json:"size"`
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
}
