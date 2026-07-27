package ai

import (
	"context"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

const postCommitBestEffortTimeout = 250 * time.Millisecond

func (service *Service) CommitPreparedLibrary(
	ctx context.Context,
	preparationToken string,
) (ReadyCommitDTO, error) {
	if service == nil || service.libraries == nil {
		return ReadyCommitDTO{}, ErrLibraryUnavailable
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return ReadyCommitDTO{}, err
	}
	candidate, attemptLease, err := service.libraries.claimPreparedForCommit(window, preparationToken)
	if err != nil {
		return ReadyCommitDTO{}, err
	}
	defer attemptLease.Finish()
	defer func() { cleanupPreparedLibrary(candidate) }()

	if candidate.kind == LibraryOperationCreate {
		if candidate.parent.Validate() != nil {
			return ReadyCommitDTO{}, ErrLibraryCapability
		}
		result, provisionErr := service.libraries.provisioner.Provision(ctx, candidate.target)
		_ = candidate.parent.Close()
		candidate.parent = rootproof.RootProof{}
		if provisionErr != nil {
			return ReadyCommitDTO{}, safeLibraryProvisionError(provisionErr)
		}
		if result.Root.Path() != result.Path || result.Root.Validate() != nil {
			_ = result.Root.Close()
			return service.createdNotActiveResult(candidate.snapshot), nil
		}
		staged, stageErr := service.prepareTrustedLibrary(
			ctx,
			candidate.window,
			candidate.generation,
			LibraryOperationCreate,
			candidate.name,
			result.RecoveryID,
			result.Root,
			session.AccessWritable,
			"",
		)
		if stageErr != nil {
			return service.createdNotActiveResult(candidate.snapshot), nil
		}
		candidate = staged
	}

	if !candidate.stagedSet || candidate.attach == nil {
		if candidate.kind == LibraryOperationOpen {
			return ReadyCommitDTO{}, ErrActivation
		}
		return service.createdNotActiveResult(candidate.snapshot), nil
	}
	var persistErr error
	capability, err := candidate.staged.CommitWith(func() error {
		persistErr = candidate.attach.Commit()
		return persistErr
	})
	candidate.stagedSet = false
	if err != nil {
		_ = candidate.attach.Abort()
		candidate.attach = nil
		if candidate.kind == LibraryOperationOpen {
			return ReadyCommitDTO{}, ErrActivation
		}
		return service.createdNotActiveResult(candidate.snapshot), nil
	}
	candidate.attach = nil
	_ = candidate.root.Close()
	candidate.root = rootproof.RootProof{}
	reference := capability.Reference()
	service.libraries.setActive(window, reference, candidate.snapshot)

	status := CommitOpenedAndActive
	recoveryRetained := false
	if candidate.kind == LibraryOperationCreate || candidate.kind == LibraryOperationRecovery {
		status = CommitCreatedAndActive
		if candidate.recoveryID == "" {
			recoveryRetained = true
		} else {
			cleanupCtx, cancelCleanup := postCommitBestEffortContext()
			cleanupErr := service.libraries.provisioner.RemovePending(cleanupCtx, candidate.recoveryID)
			cancelCleanup()
			recoveryRetained = cleanupErr != nil
		}
	}
	snapshot := cloneWorkspaceSnapshot(candidate.snapshot)
	continuityWarning := service.recordActivationBestEffort(capability.WorkspaceID)
	return ReadyCommitDTO{
		Status: status, Capability: capabilityDTO(capability), Snapshot: &snapshot,
		RecoveryRetained: recoveryRetained, ContinuityWarning: continuityWarning,
	}, nil
}

func (service *Service) recordActivationBestEffort(workspaceID workspaceid.WorkspaceID) bool {
	if service.libraryState == nil {
		return false
	}
	ctx, cancel := postCommitBestEffortContext()
	defer cancel()
	return service.libraryState.RecordActivation(ctx, workspaceID, service.now().UTC()) != nil
}

func postCommitBestEffortContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), postCommitBestEffortTimeout)
}

func (service *Service) AbortPreparedLibrary(
	ctx context.Context,
	preparationToken string,
) (PreparedLibraryAbortDTO, error) {
	if service == nil || service.libraries == nil {
		return PreparedLibraryAbortDTO{}, ErrLibraryUnavailable
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return PreparedLibraryAbortDTO{}, err
	}
	if err := service.libraries.abortPrepared(window, preparationToken); err != nil {
		return PreparedLibraryAbortDTO{}, err
	}
	return PreparedLibraryAbortDTO{Cancelled: true}, nil
}

func (service *Service) WorkspaceSnapshot(
	ctx context.Context,
	reference SessionReferenceDTO,
) (WorkspaceSnapshotDTO, error) {
	if service == nil || service.libraries == nil || !validSessionReferenceSyntax(reference) {
		return WorkspaceSnapshotDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return WorkspaceSnapshotDTO{}, err
	}
	lease, err := service.sessions.Resolve(window, reference.sessionReference())
	if err != nil {
		return WorkspaceSnapshotDTO{}, ErrSessionRejected
	}
	lease.Finish()
	snapshot, ok := service.libraries.activeSnapshot(window, reference.sessionReference())
	if !ok {
		return WorkspaceSnapshotDTO{}, ErrLibrarySnapshot
	}
	return snapshot, nil
}

func (service *Service) createdNotActiveResult(snapshot WorkspaceSnapshotDTO) ReadyCommitDTO {
	cloned := cloneWorkspaceSnapshot(snapshot)
	result := ReadyCommitDTO{
		Status: CommitCreatedNotActive, Snapshot: &cloned, RecoveryRetained: true,
	}
	pendingCtx, cancelPending := postCommitBestEffortContext()
	pending, err := service.pendingLibraryOperation(pendingCtx)
	cancelPending()
	if err == nil && pending.Available {
		result.Pending = &pending
	}
	return result
}

func capabilityDTO(capability session.Capability) *CapabilityDTO {
	return &CapabilityDTO{
		SessionID: capability.SessionID, WorkspaceID: capability.WorkspaceID,
		Generation: capability.Generation, Display: DisplayDTO{Label: capability.Display.Label},
		AccessMode: capability.AccessMode,
	}
}
