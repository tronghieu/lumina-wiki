package index

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

var (
	ErrIndexConflict   = errors.New("semantic index changed; try again")
	ErrEmbeddingFailed = errors.New("semantic embedding failed")
)

type IndexState string

const (
	StateDisabled IndexState = "disabled"
	StateEmpty    IndexState = "empty"
	StateBuilding IndexState = "building"
	StateReady    IndexState = "ready"
	StateStale    IndexState = "stale"
	StateCorrupt  IndexState = "corrupt"
	StateFailed   IndexState = "failed"
)

type IndexStatus struct {
	State      IndexState `json:"state"`
	Chunks     int        `json:"chunks"`
	Vectors    int        `json:"vectors"`
	Dimensions int        `json:"dimensions"`
}

type Progress struct {
	State     IndexState `json:"state"`
	Completed int        `json:"completed"`
	Total     int        `json:"total"`
}

type ProgressSink func(context.Context, Progress) error

type BuildRequest struct {
	WorkspaceID        workspaceid.WorkspaceID
	Chunks             []retrieval.Chunk
	SnapshotHash       string
	ChunkerVersion     string
	ProfileFingerprint string
	ExpectedModel      string
	ExpectedDimensions int
	Provider           EmbeddingProvider
}

type StatusRequest struct {
	Disabled           bool
	SnapshotHash       string
	ChunkerVersion     string
	ProfileFingerprint string
	Dimensions         int
}
