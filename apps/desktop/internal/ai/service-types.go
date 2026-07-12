package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

const MaxTypedRootBytes = workspaceid.MaxCanonicalPathBytes

var (
	ErrInvalidInput      = errors.New("invalid workspace input")
	ErrWindowUnavailable = errors.New("calling window is unavailable")
	ErrNativeAuthority   = errors.New("native workspace approval failed")
	ErrInvalidWorkspace  = errors.New("workspace validation failed")
	ErrWorkspaceAttach   = errors.New("workspace attachment failed")
	ErrRuntimeLoad       = errors.New("workspace runtime load failed")
	ErrActivation        = errors.New("workspace activation failed")
	ErrSessionRejected   = errors.New("invalid or expired session")
	ErrSessionCleanup    = errors.New("session cleanup failed")
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
	CancelRequest(session.WindowID, session.Reference, string) error
	CloseWindow(session.WindowID) error
	Close() error
}

type Dependencies struct {
	Windows   WindowResolver
	Native    NativeAuthority
	Validator WorkspaceValidator
	Attacher  WorkspaceAttacher
	Runtimes  RuntimeFactory
	Sessions  SessionRegistry
}
