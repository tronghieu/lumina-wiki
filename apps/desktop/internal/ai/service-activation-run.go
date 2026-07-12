package ai

import (
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func (service *Service) activateApproved(lease *activationLease, root string) (result ActivationResult, resultErr error) {
	if err := lease.Validate(); err != nil {
		return ActivationResult{}, err
	}
	ctx, window := lease.Context(), lease.window
	shape, err := service.validator.Validate(ctx, root)
	if leaseErr := lease.Validate(); leaseErr != nil {
		return ActivationResult{}, leaseErr
	}
	if err != nil || !shape.Valid {
		return ActivationResult{}, ErrInvalidWorkspace
	}
	if err := lease.Validate(); err != nil {
		return ActivationResult{}, err
	}
	decision, err := service.attacher.BeginAttach(root)
	if err != nil {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	pending := true
	defer func() {
		if pending {
			if err := service.attacher.CancelAttach(decision.Token); err != nil {
				result = ActivationResult{}
				resultErr = ErrWorkspaceAttach
			}
		}
	}()
	if err := lease.Validate(); err != nil {
		return ActivationResult{}, err
	}

	if decisionNeedsConfirmation(decision.Kind) {
		approved, approvalErr := service.native.ConfirmAttachDecision(ctx, window, decision.Kind)
		if leaseErr := lease.Validate(); leaseErr != nil {
			return ActivationResult{}, leaseErr
		}
		if approvalErr != nil {
			return ActivationResult{}, ErrNativeAuthority
		}
		if !approved {
			pending = false
			if err := service.attacher.CancelAttach(decision.Token); err != nil {
				return ActivationResult{}, ErrWorkspaceAttach
			}
			return cancelledResult(), nil
		}
	} else if decision.Kind != workspaceid.AttachNew && decision.Kind != workspaceid.AttachKnown {
		return ActivationResult{}, ErrWorkspaceAttach
	}

	label, err := displayBasename(decision.CanonicalPath)
	if err != nil {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	if err := lease.Validate(); err != nil {
		return ActivationResult{}, err
	}
	pending = false
	workspaceID, err := service.attacher.ConfirmAttach(decision.Token)
	if err != nil || !workspaceID.Valid() {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	if err := lease.Validate(); err != nil {
		return ActivationResult{}, err
	}
	runtime, err := service.runtimes.Load(ctx, workspaceID, decision.CanonicalPath)
	if leaseErr := lease.Validate(); leaseErr != nil {
		closeRuntime(runtime)
		return ActivationResult{}, leaseErr
	}
	if err != nil || !validRuntime(runtime) {
		closeRuntime(runtime)
		return ActivationResult{}, ErrRuntimeLoad
	}
	owned := &onceRuntime{runtime: runtime}
	finishCommit, err := lease.BeginCommit()
	if err != nil {
		_ = owned.Close()
		return ActivationResult{}, err
	}
	capability, activationErr := service.sessions.Activate(window, workspaceID, session.DisplayMetadata{Label: label}, owned)
	disposition := lease.CommitDisposition()
	if activationErr != nil {
		finishCommit()
		_ = owned.Close()
		if disposition == activationCommitWindowClosed {
			return ActivationResult{}, ErrWindowUnavailable
		}
		return ActivationResult{}, ErrActivation
	}
	if disposition == activationCommitWindowClosed {
		finishCommit()
		rollbackErr := service.sessions.Deactivate(window, capability.Reference())
		invalidAfterTombstone := errors.Is(rollbackErr, session.ErrInvalidSession) && lease.WasTombstoned()
		if rollbackErr != nil && !invalidAfterTombstone {
			return ActivationResult{}, ErrSessionCleanup
		}
		return ActivationResult{}, ErrWindowUnavailable
	}
	if disposition == activationCommitCallerCancelled {
		finishCommit()
		rollbackErr := service.sessions.Deactivate(window, capability.Reference())
		invalidAfterTombstone := errors.Is(rollbackErr, session.ErrInvalidSession) && lease.WasTombstoned()
		if rollbackErr != nil && !invalidAfterTombstone {
			return ActivationResult{}, ErrSessionCleanup
		}
		return ActivationResult{}, ErrActivation
	}
	finishCommit()
	return activeResult(capability), nil
}
