package ai

import (
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

func (service *Service) activateApproved(lease *activationLease, root string) (result ActivationResult, resultErr error) {
	validator, validatorOK := service.validator.(TrustedWorkspaceValidator)
	attacher, attacherOK := service.attacher.(PreparedWorkspaceAttacher)
	runtimes, runtimesOK := service.runtimes.(TrustedRuntimeFactory)
	sessions, sessionsOK := service.sessions.(StagedSessionRegistry)
	if validatorOK && attacherOK && runtimesOK && sessionsOK {
		return service.activateApprovedStaged(lease, root, validator, attacher, runtimes, sessions)
	}
	return service.activateApprovedLegacy(lease, root)
}

func (service *Service) activateApprovedLegacy(lease *activationLease, root string) (result ActivationResult, resultErr error) {
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

func (service *Service) activateApprovedStaged(lease *activationLease, root string,
	validator TrustedWorkspaceValidator, attacher PreparedWorkspaceAttacher,
	runtimes TrustedRuntimeFactory, sessions StagedSessionRegistry) (result ActivationResult, resultErr error) {
	if err := lease.Validate(); err != nil {
		return ActivationResult{}, err
	}
	ctx, window := lease.Context(), lease.window
	proof, err := rootproof.Open(root)
	if err != nil {
		return ActivationResult{}, ErrInvalidWorkspace
	}
	defer proof.Close()
	shape, err := validator.ValidateTrusted(ctx, root, proof)
	if leaseErr := lease.Validate(); leaseErr != nil {
		return ActivationResult{}, leaseErr
	}
	if err != nil || !shape.Valid {
		return ActivationResult{}, ErrInvalidWorkspace
	}
	prepared, decision, err := attacher.BeginAttachTrusted(root, proof)
	if err != nil || prepared == nil {
		if prepared != nil {
			_ = prepared.Abort()
		}
		return ActivationResult{}, ErrWorkspaceAttach
	}
	defer prepared.Abort()
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
			return cancelledResult(), nil
		}
	} else if decision.Kind != workspaceid.AttachNew && decision.Kind != workspaceid.AttachKnown {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	if err := prepared.Approve(decision.Token); err != nil {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	if err := lease.Validate(); err != nil {
		return ActivationResult{}, err
	}
	label, err := displayBasename(decision.CanonicalPath)
	if err != nil {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	workspaceID := prepared.WorkspaceID()
	if !workspaceID.Valid() {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	identity, err := prepared.TrustedRootIdentity()
	if err != nil {
		return ActivationResult{}, ErrWorkspaceAttach
	}
	runtime, err := runtimes.LoadTrusted(ctx, workspaceID, decision.CanonicalPath, identity)
	if leaseErr := lease.Validate(); leaseErr != nil {
		closeRuntime(runtime)
		return ActivationResult{}, leaseErr
	}
	if err != nil || !validRuntime(runtime) {
		closeRuntime(runtime)
		return ActivationResult{}, ErrRuntimeLoad
	}
	owned := &onceRuntime{runtime: runtime}
	rootLease, err := prepared.TakeRootLease()
	if err != nil {
		_ = owned.Close()
		return ActivationResult{}, ErrWorkspaceAttach
	}
	staged, err := sessions.PrepareActivation(session.SessionDescriptor{
		WindowID: window, WorkspaceID: workspaceID, Display: session.DisplayMetadata{Label: label},
		AccessMode: session.AccessReadOnly, Runtime: owned, RootLease: rootLease,
	})
	if err != nil {
		return ActivationResult{}, ErrActivation
	}
	stagedPending := true
	defer func() {
		if stagedPending {
			if abortErr := staged.Abort(); abortErr != nil && resultErr == nil {
				result = ActivationResult{}
				resultErr = ErrSessionCleanup
			}
		}
	}()
	finishCommit, err := lease.BeginCommit()
	if err != nil {
		return ActivationResult{}, err
	}
	disposition := lease.CommitDisposition()
	if disposition != activationCommitDeliver {
		finishCommit()
		if disposition == activationCommitWindowClosed {
			return ActivationResult{}, ErrWindowUnavailable
		}
		return ActivationResult{}, ErrActivation
	}
	var persistErr error
	capability, err := staged.CommitWith(func() error {
		persistErr = prepared.Commit()
		return persistErr
	})
	if err != nil {
		stagedPending = false
		finishCommit()
		if persistErr != nil {
			return ActivationResult{}, ErrWorkspaceAttach
		}
		if lease.CommitDisposition() == activationCommitWindowClosed {
			return ActivationResult{}, ErrWindowUnavailable
		}
		return ActivationResult{}, ErrActivation
	}
	stagedPending = false
	disposition = lease.CommitDisposition()
	finishCommit()
	if disposition == activationCommitWindowClosed {
		rollbackErr := sessions.Deactivate(window, capability.Reference())
		invalidAfterTombstone := errors.Is(rollbackErr, session.ErrInvalidSession) && lease.WasTombstoned()
		if rollbackErr != nil && !invalidAfterTombstone {
			return ActivationResult{}, ErrSessionCleanup
		}
		return ActivationResult{}, ErrWindowUnavailable
	}
	if disposition == activationCommitCallerCancelled {
		rollbackErr := sessions.Deactivate(window, capability.Reference())
		invalidAfterTombstone := errors.Is(rollbackErr, session.ErrInvalidSession) && lease.WasTombstoned()
		if rollbackErr != nil && !invalidAfterTombstone {
			return ActivationResult{}, ErrSessionCleanup
		}
		return ActivationResult{}, ErrActivation
	}
	return activeResult(capability), nil
}
