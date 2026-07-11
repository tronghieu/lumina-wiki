package workspaceid

import (
	"errors"
	"regexp"
	"time"
)

const (
	CurrentSchemaVersion  = 1
	MaxRegistryBytes      = 256 * 1024
	MaxRegistryRecords    = 256
	MaxCanonicalPathBytes = 4096
	MaxSignatureBytes     = 256
	MaxActiveDecisions    = 64
	DefaultDecisionTTL    = 5 * time.Minute
)

var (
	ErrInvalidDecisionToken = errors.New("workspace confirmation is invalid or expired")
	ErrRegistryBusy         = errors.New("workspace registry is busy")
	ErrRegistryConflict     = errors.New("workspace registry changed; try again")
	ErrCandidateChanged     = errors.New("workspace changed during confirmation")
	workspaceIDPattern      = regexp.MustCompile(`^ws_[a-f0-9]{32}$`)
)

type WorkspaceID string

func (id WorkspaceID) Valid() bool { return workspaceIDPattern.MatchString(string(id)) }

func ParseWorkspaceID(value string) (WorkspaceID, error) {
	id := WorkspaceID(value)
	if !id.Valid() {
		return "", errors.New("workspace identity is invalid")
	}
	return id, nil
}

type Signature string

type AttachKind string

const (
	AttachNew                           AttachKind = "new"
	AttachKnown                         AttachKind = "known"
	AttachIdentityConfirmationRequired  AttachKind = "identity_confirmation_required"
	AttachRenameConfirmationRequired    AttachKind = "rename_confirmation_required"
	AttachPathReuseConfirmationRequired AttachKind = "path_reuse_confirmation_required"
	AttachAmbiguousConfirmationRequired AttachKind = "ambiguous_confirmation_required"
)

type AttachDecision struct {
	Kind          AttachKind `json:"kind"`
	Token         string     `json:"token"`
	CanonicalPath string     `json:"canonicalPath"`
	ExpiresAt     time.Time  `json:"expiresAt"`
}

type Record struct {
	SchemaVersion       int         `json:"schemaVersion"`
	WorkspaceID         WorkspaceID `json:"workspaceId"`
	CanonicalPath       string      `json:"canonicalPath"`
	FilesystemSignature Signature   `json:"filesystemSignature,omitempty"`
	FirstSeenAt         time.Time   `json:"firstSeenAt"`
	LastSeenAt          time.Time   `json:"lastSeenAt"`
	Active              bool        `json:"active"`
}

type Registry struct {
	SchemaVersion int      `json:"schemaVersion"`
	Records       []Record `json:"records"`
}

func emptyRegistry() Registry {
	return Registry{SchemaVersion: CurrentSchemaVersion, Records: []Record{}}
}
