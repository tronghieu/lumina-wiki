package ai

import (
	"context"
	"io"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

const (
	MaxLibraryNameBytes       = 128
	MaxSnapshotGraphNodes     = 8192
	MaxSnapshotGraphEdges     = 32768
	MaxSnapshotWarnings       = 64
	MaxSnapshotDisplayBytes   = 256
	MaxSnapshotTitleBytes     = 1024
	MaxSnapshotPreviewBytes   = 4096
	MaxSnapshotGraphTypeBytes = 128
)

type LocationStatus string

const (
	LocationApproved  LocationStatus = "approved"
	LocationCancelled LocationStatus = "cancelled"
)

type PreparationStatus string

const (
	PreparationReady     PreparationStatus = "ready"
	PreparationCancelled PreparationStatus = "cancelled"
)

type ReadyCommitStatus string

const (
	CommitCancelledBeforeCommit ReadyCommitStatus = "cancelled_before_commit"
	CommitCreatedAndActive      ReadyCommitStatus = "created_and_active"
	CommitCreatedNotActive      ReadyCommitStatus = "created_not_active"
	CommitOpenedAndActive       ReadyCommitStatus = "opened_and_active"
)

type LibraryOperationKind string

const (
	LibraryOperationCreate   LibraryOperationKind = "create"
	LibraryOperationOpen     LibraryOperationKind = "open"
	LibraryOperationRecovery LibraryOperationKind = "recovery"
)

type PendingLibraryPhase string

const (
	PendingLibraryApproved  PendingLibraryPhase = "approved"
	PendingLibraryMutating  PendingLibraryPhase = "mutating"
	PendingLibraryCommitted PendingLibraryPhase = "committed"
)

type LocationCapabilityDTO struct {
	Status LocationStatus `json:"status"`
	Token  string         `json:"token,omitempty"`
}

type PreparedLibraryDTO struct {
	Status           PreparationStatus    `json:"status"`
	PreparationToken string               `json:"preparationToken,omitempty"`
	Kind             LibraryOperationKind `json:"kind,omitempty"`
	Snapshot         WorkspaceSnapshotDTO `json:"snapshot"`
}

type ReadyCommitDTO struct {
	Status            ReadyCommitStatus           `json:"status"`
	Capability        *CapabilityDTO              `json:"capability,omitempty"`
	Snapshot          *WorkspaceSnapshotDTO       `json:"snapshot,omitempty"`
	Pending           *PendingLibraryOperationDTO `json:"pending,omitempty"`
	RecoveryRetained  bool                        `json:"recoveryRetained,omitempty"`
	ContinuityWarning bool                        `json:"continuityWarning,omitempty"`
}

type WorkspaceSnapshotDTO struct {
	Display       DisplayDTO            `json:"display"`
	Summary       WorkspaceSummaryDTO   `json:"summary"`
	Graph         WorkspaceGraphDTO     `json:"graph"`
	Tree          WorkspaceTreeDTO      `json:"tree"`
	AccessMode    session.AccessMode    `json:"accessMode"`
	NoteAvailable bool                  `json:"noteAvailable"`
	Warnings      []WorkspaceWarningDTO `json:"warnings"`
}

type WorkspaceSummaryDTO struct {
	Notes         int `json:"notes"`
	Sources       int `json:"sources"`
	Relationships int `json:"relationships"`
}

type WorkspaceGraphDTO struct {
	Nodes []WorkspaceGraphNodeDTO `json:"nodes"`
	Edges []WorkspaceGraphEdgeDTO `json:"edges"`
}

type WorkspaceGraphNodeDTO struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Type    string `json:"type"`
	Path    string `json:"path"`
	Preview string `json:"preview,omitempty"`
}

type WorkspaceGraphEdgeDTO struct {
	From string `json:"from"`
	Type string `json:"type"`
	To   string `json:"to"`
}

type WorkspaceWarningDTO struct {
	Code string `json:"code"`
	Path string `json:"path,omitempty"`
}

type PendingLibraryOperationDTO struct {
	Available  bool                `json:"available"`
	RecoveryID string              `json:"recoveryId,omitempty"`
	Name       string              `json:"name,omitempty"`
	Phase      PendingLibraryPhase `json:"phase,omitempty"`
}

type PendingLibraryRemovalDTO struct {
	Removed bool `json:"removed"`
}

type PreparedLibraryAbortDTO struct {
	Cancelled bool `json:"cancelled"`
}

type LibraryProvisioner interface {
	Classify(context.Context, string) (workspace.TargetClassification, error)
	Provision(context.Context, string) (workspace.ProvisionResult, error)
	RetryPending(context.Context, string) (workspace.ProvisionResult, error)
	PendingOperation(context.Context) (workspace.PendingLibraryOperation, bool, error)
	RemovePending(context.Context, string) error
}

type LibraryProvisioningDependencies struct {
	Provisioner   LibraryProvisioner
	DefaultParent func() (string, error)
	Random        io.Reader
	Now           func() time.Time
	TTL           time.Duration
}
