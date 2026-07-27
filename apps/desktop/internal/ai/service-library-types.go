package ai

import (
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appstate"
)

const (
	ArtifactLocatorVersion = 1
	ArtifactKindWikiNote   = "wiki_note"
)

type WorkspaceFocus string

const (
	WorkspaceFocusChat  WorkspaceFocus = "chat"
	WorkspaceFocusNote  WorkspaceFocus = "note"
	WorkspaceFocusGraph WorkspaceFocus = "graph"
)

type ArtifactLocatorV1DTO struct {
	Version      int    `json:"version"`
	Kind         string `json:"kind"`
	RelativePath string `json:"relativePath"`
}

type WorkspaceNoteRequestDTO struct {
	Session  SessionReferenceDTO  `json:"session"`
	Artifact ArtifactLocatorV1DTO `json:"artifact"`
}

type NoteContentDTO struct {
	Artifact ArtifactLocatorV1DTO `json:"artifact"`
	Content  string               `json:"content"`
}

type ContinuityStatus string

const (
	ContinuityLoaded      ContinuityStatus = "loaded"
	ContinuityEmpty       ContinuityStatus = "empty"
	ContinuityUnavailable ContinuityStatus = "unavailable"
)

type PreparedContinuityDTO struct {
	Prepared       PreparedLibraryDTO   `json:"prepared"`
	Focus          WorkspaceFocus       `json:"focus"`
	ArtifactStatus ContinuityStatus     `json:"artifactStatus"`
	Artifact       *NoteContentDTO      `json:"artifact,omitempty"`
	HistoryStatus  history.LatestStatus `json:"historyStatus"`
	ConversationID string               `json:"conversationId,omitempty"`
}

type RestoreRecentLibraryRequestDTO struct {
	WorkspaceID workspaceid.WorkspaceID `json:"workspaceId"`
}

type FindRecentLibraryRequestDTO struct {
	WorkspaceID workspaceid.WorkspaceID `json:"workspaceId"`
}

type RecentLibraryStatus string

const (
	RecentLibraryAvailable   RecentLibraryStatus = "available"
	RecentLibraryUnavailable RecentLibraryStatus = "unavailable"
)

type RecentLibraryDTO struct {
	WorkspaceID workspaceid.WorkspaceID `json:"workspaceId"`
	Label       string                  `json:"label"`
	ActivatedAt time.Time               `json:"activatedAt"`
	Status      RecentLibraryStatus     `json:"status"`
	Focus       WorkspaceFocus          `json:"focus,omitempty"`
}

type RecentLibrariesDTO struct {
	Libraries []RecentLibraryDTO `json:"libraries"`
}

type SaveWorkspaceViewRequestDTO struct {
	Session  SessionReferenceDTO   `json:"session"`
	Focus    WorkspaceFocus        `json:"focus"`
	Artifact *ArtifactLocatorV1DTO `json:"artifact,omitempty"`
}

type WorkspaceViewDTO struct {
	Focus    WorkspaceFocus        `json:"focus"`
	Artifact *ArtifactLocatorV1DTO `json:"artifact,omitempty"`
}

type RecentLibraryRequestDTO struct {
	WorkspaceID workspaceid.WorkspaceID `json:"workspaceId"`
}

type RemoveRecentLibraryResultDTO struct {
	Removed bool `json:"removed"`
}

type ResetConfirmationStatus string

const (
	ResetConfirmationReady     ResetConfirmationStatus = "ready"
	ResetConfirmationCancelled ResetConfirmationStatus = "cancelled"
)

type ResetRecentViewStateConfirmationDTO struct {
	Status ResetConfirmationStatus `json:"status"`
	Token  string                  `json:"token,omitempty"`
}

type ResetRecentViewStateResultDTO struct {
	Status appstate.ResetOutcome `json:"status"`
}
