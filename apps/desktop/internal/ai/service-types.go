package ai

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appstate"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

const MaxTypedRootBytes = workspaceid.MaxCanonicalPathBytes

var (
	ErrInvalidInput          = errors.New("invalid workspace input")
	ErrWindowUnavailable     = errors.New("calling window is unavailable")
	ErrNativeAuthority       = errors.New("native workspace approval failed")
	ErrInvalidWorkspace      = errors.New("workspace validation failed")
	ErrWorkspaceAttach       = errors.New("workspace attachment failed")
	ErrRuntimeLoad           = errors.New("workspace runtime load failed")
	ErrActivation            = errors.New("workspace activation failed")
	ErrActivationBusy        = errors.New("workspace activation already in progress")
	ErrSessionRejected       = errors.New("invalid or expired session")
	ErrSessionCleanup        = errors.New("session cleanup failed")
	ErrEventDispatch         = errors.New("chat event dispatch failed")
	ErrSettingsUnavailable   = errors.New("AI settings are unavailable")
	ErrCredentialUnavailable = errors.New("credential operation is unavailable")
	ErrLibraryUnavailable    = errors.New("library operation is unavailable")
	ErrLibraryCapability     = errors.New("library capability is invalid or expired")
	ErrLibraryCollision      = errors.New("library destination is unavailable")
	ErrLibrarySnapshot       = errors.New("library snapshot is unavailable")
)

type ActivationStatus string

const (
	ActivationActive    ActivationStatus = "active"
	ActivationCancelled ActivationStatus = "cancelled"
)

type DirectorySelection struct {
	Path     string
	Approved bool
}

type WorkspaceShape struct {
	Valid bool
}

type DisplayDTO struct {
	Label string `json:"label"`
}

type CapabilityDTO struct {
	SessionID   session.SessionID       `json:"sessionId"`
	WorkspaceID workspaceid.WorkspaceID `json:"workspaceId"`
	Generation  session.Generation      `json:"generation"`
	Display     DisplayDTO              `json:"display"`
	AccessMode  session.AccessMode      `json:"accessMode"`
}

type SessionReferenceDTO struct {
	SessionID  session.SessionID  `json:"sessionId"`
	Generation session.Generation `json:"generation"`
}

type ActivationResult struct {
	Status     ActivationStatus `json:"status"`
	Capability *CapabilityDTO   `json:"capability,omitempty"`
}

type WindowResolver interface {
	ResolveWindow(context.Context) (session.WindowID, error)
}

type NativeAuthority interface {
	ChooseDirectory(context.Context, session.WindowID) (DirectorySelection, error)
	ConfirmDirectory(context.Context, session.WindowID, string) (bool, error)
	ConfirmAttachDecision(context.Context, session.WindowID, workspaceid.AttachKind) (bool, error)
	ConfirmEmbeddingDisclosure(context.Context, session.WindowID, EmbeddingDisclosure) (bool, error)
}

type LibraryNativeAuthority interface {
	NativeAuthority
	ConfirmCreateDestination(context.Context, session.WindowID, string) (bool, error)
	ConfirmUseEmptyDirectory(context.Context, session.WindowID, string) (bool, error)
}

type RecentActivityNativeAuthority interface {
	ConfirmResetRecentActivity(context.Context, session.WindowID) (bool, error)
}

type EmbeddingDisclosure struct {
	ProfileID         string
	ProviderLabel     string
	ProviderKind      string
	Model             string
	EndpointOrigin    string
	Kind              string
	DisclosureVersion int
}

type WorkspaceValidator interface {
	Validate(context.Context, string) (WorkspaceShape, error)
}

type TrustedWorkspaceValidator interface {
	WorkspaceValidator
	ValidateTrusted(context.Context, string, rootproof.RootProof) (WorkspaceShape, error)
}

type WorkspaceAttacher interface {
	BeginAttach(string) (workspaceid.AttachDecision, error)
	ConfirmAttach(string) (workspaceid.WorkspaceID, error)
	CancelAttach(string) error
}

type PreparedWorkspaceAttacher interface {
	WorkspaceAttacher
	BeginAttachTrusted(string, rootproof.RootProof) (*workspaceid.PreparedAttach, workspaceid.AttachDecision, error)
}

type WorkspaceRecentResolver interface {
	ResolveRecent([]workspaceid.WorkspaceID) ([]workspaceid.RecentWorkspace, error)
	BeginRestore(workspaceid.WorkspaceID) (workspaceid.AttachDecision, error)
	BeginFind(workspaceid.WorkspaceID, string) (workspaceid.AttachDecision, error)
}

type LibraryStateRepository interface {
	Snapshot(context.Context) (appstate.Snapshot, error)
	RecordActivation(context.Context, workspaceid.WorkspaceID, time.Time) error
	SaveView(context.Context, workspaceid.WorkspaceID, appstate.WorkspaceView) error
	RemoveRecent(context.Context, workspaceid.WorkspaceID) error
	ResetRecentViewState(context.Context) (appstate.ResetOutcome, error)
}

type RuntimeFactory interface {
	Load(context.Context, workspaceid.WorkspaceID, string) (session.Runtime, error)
}

type TrustedRuntimeFactory interface {
	RuntimeFactory
	LoadTrusted(context.Context, workspaceid.WorkspaceID, string, os.FileInfo) (session.Runtime, error)
}

type SessionRegistry interface {
	Activate(session.WindowID, workspaceid.WorkspaceID, session.DisplayMetadata, session.Runtime) (session.Capability, error)
	Deactivate(session.WindowID, session.Reference) error
	BeginDeactivate(session.WindowID, session.Reference) (func() error, error)
	BeginRequest(context.Context, session.WindowID, session.Reference, string) (context.Context, *session.RequestLease, error)
	Resolve(session.WindowID, session.Reference) (*session.RuntimeLease, error)
	CancelRequest(session.WindowID, session.Reference, string) error
	CloseWindow(session.WindowID) error
	Close() error
}

// StagedSessionRegistry is the additive backend activation seam used by
// coordinated identity/session transactions. Existing SessionRegistry test
// doubles and callers need not implement staging until they adopt that flow.
type StagedSessionRegistry interface {
	SessionRegistry
	ActivateDescriptor(session.SessionDescriptor) (session.Capability, error)
	PrepareActivation(session.SessionDescriptor) (session.StagedActivation, error)
}

type SettingsRepository interface {
	Load() (settings.Config, error)
	Save(settings.Config) error
}

var _ StagedSessionRegistry = (*session.Registry)(nil)

type CredentialRepository interface {
	Status(context.Context, string) (secrets.CredentialStatus, error)
	Save(context.Context, string, []byte) (secrets.SaveResult, error)
	ConfirmSessionCredential(context.Context, string, []byte) error
	Delete(context.Context, string) error
}

type Dependencies struct {
	ConsentAccess *ConsentAccessGate
	Windows       WindowResolver
	Native        NativeAuthority
	Validator     WorkspaceValidator
	Attacher      WorkspaceAttacher
	Runtimes      RuntimeFactory
	Sessions      SessionRegistry
	Streams       StreamSinkFactory
	Settings      SettingsRepository
	Credentials   CredentialRepository
	Library       *LibraryProvisioningDependencies
	LibraryState  LibraryStateRepository
	Now           func() time.Time
}
