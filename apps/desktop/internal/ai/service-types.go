package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
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
}

type WorkspaceValidator interface {
	Validate(context.Context, string) (WorkspaceShape, error)
}

type WorkspaceAttacher interface {
	BeginAttach(string) (workspaceid.AttachDecision, error)
	ConfirmAttach(string) (workspaceid.WorkspaceID, error)
	CancelAttach(string) error
}

type RuntimeFactory interface {
	Load(context.Context, workspaceid.WorkspaceID, string) (session.Runtime, error)
}

type SessionRegistry interface {
	Activate(session.WindowID, workspaceid.WorkspaceID, session.DisplayMetadata, session.Runtime) (session.Capability, error)
	Deactivate(session.WindowID, session.Reference) error
	BeginRequest(context.Context, session.WindowID, session.Reference, string) (context.Context, *session.RequestLease, error)
	Resolve(session.WindowID, session.Reference) (*session.RuntimeLease, error)
	CancelRequest(session.WindowID, session.Reference, string) error
	CloseWindow(session.WindowID) error
	Close() error
}

type SettingsRepository interface {
	Load() (settings.Config, error)
	Save(settings.Config) error
}

type CredentialRepository interface {
	Status(context.Context, string) (secrets.CredentialStatus, error)
	Save(context.Context, string, []byte) (secrets.SaveResult, error)
	ConfirmSessionCredential(context.Context, string, []byte) error
	Delete(context.Context, string) error
}

type Dependencies struct {
	Windows     WindowResolver
	Native      NativeAuthority
	Validator   WorkspaceValidator
	Attacher    WorkspaceAttacher
	Runtimes    RuntimeFactory
	Sessions    SessionRegistry
	Streams     StreamSinkFactory
	Settings    SettingsRepository
	Credentials CredentialRepository
}
