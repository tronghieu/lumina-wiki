package appstate

import (
	"errors"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

const (
	CurrentSchemaVersion = 1
	MaxRecentWorkspaces  = 12
	MaxArtifactPathBytes = 1024
	MaxStateBytes        = 256 * 1024
)

var (
	ErrInvalidState = errors.New("recent activity state is invalid")
	ErrCorruptState = errors.New("recent activity state is corrupt")
)

type Focus string

const (
	FocusChat  Focus = "chat"
	FocusNote  Focus = "note"
	FocusGraph Focus = "graph"
)

type ArtifactKind string

const ArtifactWikiNote ArtifactKind = "wiki_note"

type ArtifactLocatorV1 struct {
	Version      int          `json:"version"`
	Kind         ArtifactKind `json:"kind"`
	RelativePath string       `json:"relativePath"`
}

func (locator ArtifactLocatorV1) Validate() error {
	name := locator.RelativePath
	if locator.Version != 1 || locator.Kind != ArtifactWikiNote || name == "" ||
		len(name) > MaxArtifactPathBytes || !utf8.ValidString(name) ||
		strings.ContainsRune(name, '\x00') || strings.Contains(name, `\`) || strings.Contains(name, ":") ||
		strings.HasPrefix(name, "/") || path.Clean(name) != name ||
		!strings.HasPrefix(name, "wiki/") || len(name) <= len("wiki/.md") ||
		!strings.HasSuffix(strings.ToLower(name), ".md") {
		return ErrInvalidState
	}
	for _, segment := range strings.Split(name, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return ErrInvalidState
		}
	}
	return nil
}

type WorkspaceView struct {
	Focus    Focus              `json:"focus"`
	Artifact *ArtifactLocatorV1 `json:"artifact,omitempty"`
}

func (view WorkspaceView) Validate() error {
	if view.Focus != FocusChat && view.Focus != FocusNote && view.Focus != FocusGraph {
		return ErrInvalidState
	}
	if view.Artifact != nil {
		if err := view.Artifact.Validate(); err != nil {
			return err
		}
	}
	return nil
}

type RecentWorkspace struct {
	WorkspaceID workspaceid.WorkspaceID `json:"workspaceId"`
	ActivatedAt time.Time               `json:"activatedAt"`
}

type Snapshot struct {
	SchemaVersion   int                                       `json:"schemaVersion"`
	Revision        uint64                                    `json:"revision"`
	Recent          []RecentWorkspace                         `json:"recent"`
	Views           map[workspaceid.WorkspaceID]WorkspaceView `json:"views"`
	LastWorkspaceID workspaceid.WorkspaceID                   `json:"lastWorkspaceId,omitempty"`
}

func emptySnapshot() Snapshot {
	return Snapshot{
		SchemaVersion: CurrentSchemaVersion,
		Recent:        []RecentWorkspace{},
		Views:         map[workspaceid.WorkspaceID]WorkspaceView{},
	}
}

func (snapshot Snapshot) validate() error {
	if snapshot.SchemaVersion != CurrentSchemaVersion || len(snapshot.Recent) > MaxRecentWorkspaces ||
		snapshot.Views == nil || len(snapshot.Views) > MaxRecentWorkspaces {
		return ErrInvalidState
	}
	seen := make(map[workspaceid.WorkspaceID]struct{}, len(snapshot.Recent))
	for index, recent := range snapshot.Recent {
		if !recent.WorkspaceID.Valid() || !validStateTime(recent.ActivatedAt) {
			return ErrInvalidState
		}
		if _, exists := seen[recent.WorkspaceID]; exists {
			return ErrInvalidState
		}
		seen[recent.WorkspaceID] = struct{}{}
		if index > 0 && !recentBefore(snapshot.Recent[index-1], recent) {
			return ErrInvalidState
		}
	}
	for id, view := range snapshot.Views {
		if !id.Valid() {
			return ErrInvalidState
		}
		if _, exists := seen[id]; !exists {
			return ErrInvalidState
		}
		if err := view.Validate(); err != nil {
			return err
		}
	}
	if snapshot.LastWorkspaceID != "" {
		if !snapshot.LastWorkspaceID.Valid() {
			return ErrInvalidState
		}
		if _, exists := seen[snapshot.LastWorkspaceID]; !exists {
			return ErrInvalidState
		}
	}
	return nil
}

func validStateTime(value time.Time) bool {
	return !value.IsZero() && value.Year() >= 1970 && value.Year() <= 9999 &&
		value.Location() == time.UTC
}

func recentBefore(left, right RecentWorkspace) bool {
	if left.ActivatedAt.Equal(right.ActivatedAt) {
		return left.WorkspaceID < right.WorkspaceID
	}
	return left.ActivatedAt.After(right.ActivatedAt)
}
