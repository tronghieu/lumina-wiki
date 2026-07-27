package session

import "github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"

type AccessMode string

const (
	AccessReadOnly AccessMode = "read-only"
	AccessWritable AccessMode = "writable"
)

func (mode AccessMode) Valid() bool {
	return mode == AccessReadOnly || mode == AccessWritable
}

// TrustedRootLease pins the backend-approved workspace root for the lifetime
// of a prepared or active session. It is never exposed through frontend DTOs.
type TrustedRootLease interface {
	Close() error
}

// SessionDescriptor is backend-only activation input. It deliberately carries
// no canonical path or frontend authority.
type SessionDescriptor struct {
	WindowID    WindowID
	WorkspaceID workspaceid.WorkspaceID
	Display     DisplayMetadata
	AccessMode  AccessMode
	Runtime     Runtime
	RootLease   TrustedRootLease
}
