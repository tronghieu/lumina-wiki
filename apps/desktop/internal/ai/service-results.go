package ai

import (
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func decisionNeedsConfirmation(kind workspaceid.AttachKind) bool {
	switch kind {
	case workspaceid.AttachIdentityConfirmationRequired,
		workspaceid.AttachRenameConfirmationRequired,
		workspaceid.AttachPathReuseConfirmationRequired,
		workspaceid.AttachAmbiguousConfirmationRequired:
		return true
	default:
		return false
	}
}

func cancelledResult() ActivationResult {
	return ActivationResult{Status: ActivationCancelled}
}

func activeResult(capability session.Capability) ActivationResult {
	return ActivationResult{
		Status: ActivationActive,
		Capability: &CapabilityDTO{
			SessionID:   capability.SessionID,
			WorkspaceID: capability.WorkspaceID,
			Generation:  capability.Generation,
			Display:     DisplayDTO{Label: capability.Display.Label},
		},
	}
}
