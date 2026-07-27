package ai

import (
	"context"
	"errors"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

var errLibraryPreparationCancelled = errors.New("library preparation cancelled")

func (service *Service) PrepareChooseWorkspace(ctx context.Context) (PreparedLibraryDTO, error) {
	if service == nil || service.libraries == nil {
		return PreparedLibraryDTO{}, ErrLibraryUnavailable
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return PreparedLibraryDTO{}, err
	}
	generation, err := service.libraries.beginAttempt(window)
	if err != nil {
		return PreparedLibraryDTO{}, err
	}
	selection, err := service.native.ChooseDirectory(ctx, window)
	if err != nil || ctx.Err() != nil {
		return PreparedLibraryDTO{}, ErrNativeAuthority
	}
	if !selection.Approved {
		return PreparedLibraryDTO{Status: PreparationCancelled}, nil
	}
	if !validTypedRoot(selection.Path) {
		return PreparedLibraryDTO{}, ErrInvalidWorkspace
	}
	approved, err := service.native.ConfirmDirectory(ctx, window, selection.Path)
	if err != nil || ctx.Err() != nil {
		return PreparedLibraryDTO{}, ErrNativeAuthority
	}
	if !approved {
		return PreparedLibraryDTO{Status: PreparationCancelled}, nil
	}
	proof, err := rootproof.Open(selection.Path)
	if err != nil {
		return PreparedLibraryDTO{}, ErrInvalidWorkspace
	}
	name, err := displayBasename(selection.Path)
	if err != nil {
		_ = proof.Close()
		return PreparedLibraryDTO{}, ErrInvalidWorkspace
	}
	candidate, err := service.prepareTrustedLibrary(
		ctx,
		window,
		generation,
		LibraryOperationOpen,
		name,
		"",
		proof,
		session.AccessReadOnly,
		"",
	)
	if errors.Is(err, errLibraryPreparationCancelled) {
		return PreparedLibraryDTO{Status: PreparationCancelled}, nil
	}
	if err != nil {
		return PreparedLibraryDTO{}, err
	}
	if err := service.libraries.addPrepared(candidate); err != nil {
		cleanupPreparedLibrary(candidate)
		return PreparedLibraryDTO{}, err
	}
	return preparedLibraryDTO(candidate), nil
}

func (service *Service) ListPendingLibraryOperation(ctx context.Context) (PendingLibraryOperationDTO, error) {
	if service == nil || service.libraries == nil {
		return PendingLibraryOperationDTO{}, ErrLibraryUnavailable
	}
	if _, err := service.resolveWindow(ctx); err != nil {
		return PendingLibraryOperationDTO{}, err
	}
	return service.pendingLibraryOperation(ctx)
}

func (service *Service) pendingLibraryOperation(ctx context.Context) (PendingLibraryOperationDTO, error) {
	pending, exists, err := service.libraries.provisioner.PendingOperation(ctx)
	if err != nil {
		return PendingLibraryOperationDTO{}, safeLibraryProvisionError(err)
	}
	if !exists {
		return PendingLibraryOperationDTO{Available: false}, nil
	}
	phase, ok := safePendingLibraryPhase(pending.Phase)
	if !ok || !validRecoveryToken(pending.RecoveryID) || !validLibraryName(pending.Name) {
		return PendingLibraryOperationDTO{}, ErrLibraryUnavailable
	}
	return PendingLibraryOperationDTO{
		Available: true, RecoveryID: pending.RecoveryID, Name: pending.Name, Phase: phase,
	}, nil
}

func (service *Service) PreparePendingLibraryOperation(
	ctx context.Context,
	recoveryID string,
) (PreparedLibraryDTO, error) {
	if service == nil || service.libraries == nil || !validRecoveryToken(recoveryID) {
		return PreparedLibraryDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return PreparedLibraryDTO{}, err
	}
	pending, exists, err := service.libraries.provisioner.PendingOperation(ctx)
	if err != nil {
		return PreparedLibraryDTO{}, safeLibraryProvisionError(err)
	}
	if !exists || pending.RecoveryID != recoveryID || !validLibraryName(pending.Name) {
		return PreparedLibraryDTO{}, ErrLibraryCapability
	}
	generation, err := service.libraries.beginAttempt(window)
	if err != nil {
		return PreparedLibraryDTO{}, err
	}
	result, err := service.libraries.provisioner.RetryPending(ctx, recoveryID)
	if err != nil {
		return PreparedLibraryDTO{}, safeLibraryProvisionError(err)
	}
	if result.Root.Path() != result.Path || result.Root.Validate() != nil {
		_ = result.Root.Close()
		return PreparedLibraryDTO{}, ErrLibraryUnavailable
	}
	candidate, err := service.prepareTrustedLibrary(
		ctx,
		window,
		generation,
		LibraryOperationRecovery,
		pending.Name,
		recoveryID,
		result.Root,
		session.AccessWritable,
		"",
	)
	if errors.Is(err, errLibraryPreparationCancelled) {
		return PreparedLibraryDTO{Status: PreparationCancelled}, nil
	}
	if err != nil {
		return PreparedLibraryDTO{}, err
	}
	if err := service.libraries.addPrepared(candidate); err != nil {
		cleanupPreparedLibrary(candidate)
		return PreparedLibraryDTO{}, err
	}
	return preparedLibraryDTO(candidate), nil
}

func (service *Service) RemovePendingLibraryOperation(
	ctx context.Context,
	recoveryID string,
) (PendingLibraryRemovalDTO, error) {
	if service == nil || service.libraries == nil || !validRecoveryToken(recoveryID) {
		return PendingLibraryRemovalDTO{}, ErrInvalidInput
	}
	window, err := service.resolveWindow(ctx)
	if err != nil {
		return PendingLibraryRemovalDTO{}, err
	}
	pending, exists, err := service.libraries.provisioner.PendingOperation(ctx)
	if err != nil {
		return PendingLibraryRemovalDTO{}, safeLibraryProvisionError(err)
	}
	if !exists || pending.RecoveryID != recoveryID {
		return PendingLibraryRemovalDTO{}, ErrLibraryCapability
	}
	if _, err := service.libraries.beginAttempt(window); err != nil {
		return PendingLibraryRemovalDTO{}, err
	}
	if err := service.libraries.provisioner.RemovePending(ctx, recoveryID); err != nil {
		return PendingLibraryRemovalDTO{}, safeLibraryProvisionError(err)
	}
	return PendingLibraryRemovalDTO{Removed: true}, nil
}

func (service *Service) prepareTrustedLibrary(
	ctx context.Context,
	window session.WindowID,
	generation uint64,
	kind LibraryOperationKind,
	name string,
	recoveryID string,
	proof rootproof.RootProof,
	access session.AccessMode,
	expectedWorkspaceID workspaceid.WorkspaceID,
) (_ *preparedLibrary, resultErr error) {
	candidate := &preparedLibrary{
		window: window, generation: generation, kind: kind, name: name,
		target: proof.Path(), recoveryID: recoveryID, root: proof,
	}
	defer func() {
		if resultErr != nil {
			cleanupPreparedLibrary(candidate)
		}
	}()
	if ctx == nil || ctx.Err() != nil || !validLibraryName(name) || proof.Validate() != nil || !access.Valid() {
		return nil, ErrLibraryUnavailable
	}
	validator, validatorOK := service.validator.(TrustedWorkspaceValidator)
	attacher, attacherOK := service.attacher.(PreparedWorkspaceAttacher)
	runtimes, runtimesOK := service.runtimes.(TrustedRuntimeFactory)
	sessions, sessionsOK := service.sessions.(StagedSessionRegistry)
	if !validatorOK || !attacherOK || !runtimesOK || !sessionsOK {
		return nil, ErrLibraryUnavailable
	}
	shape, err := validator.ValidateTrusted(ctx, candidate.target, proof)
	if err != nil || !shape.Valid || proof.Validate() != nil {
		return nil, ErrInvalidWorkspace
	}
	preparedAttach, decision, err := attacher.BeginAttachTrusted(candidate.target, proof)
	if err != nil || preparedAttach == nil {
		return nil, ErrWorkspaceAttach
	}
	candidate.attach = preparedAttach
	if expectedWorkspaceID != "" && preparedAttach.WorkspaceID() != expectedWorkspaceID {
		return nil, ErrWorkspaceAttach
	}
	if decisionNeedsConfirmation(decision.Kind) {
		approved, approvalErr := service.native.ConfirmAttachDecision(ctx, window, decision.Kind)
		if approvalErr != nil || ctx.Err() != nil {
			return nil, ErrNativeAuthority
		}
		if !approved {
			return nil, errLibraryPreparationCancelled
		}
	} else if decision.Kind != workspaceid.AttachNew && decision.Kind != workspaceid.AttachKnown {
		return nil, ErrWorkspaceAttach
	}
	if err := preparedAttach.Approve(decision.Token); err != nil {
		return nil, ErrWorkspaceAttach
	}
	identity, err := preparedAttach.TrustedRootIdentity()
	if err != nil {
		return nil, ErrWorkspaceAttach
	}
	snapshot, err := buildWorkspaceSnapshot(ctx, name, access, candidate.target, proof, identity)
	if err != nil {
		return nil, err
	}
	runtime, err := runtimes.LoadTrusted(ctx, preparedAttach.WorkspaceID(), candidate.target, identity)
	if err != nil || !validRuntime(runtime) {
		closeRuntime(runtime)
		return nil, ErrRuntimeLoad
	}
	owned := &onceRuntime{runtime: runtime}
	rootLease, err := preparedAttach.TakeRootLease()
	if err != nil {
		_ = owned.Close()
		return nil, ErrWorkspaceAttach
	}
	staged, err := sessions.PrepareActivation(session.SessionDescriptor{
		WindowID: window, WorkspaceID: preparedAttach.WorkspaceID(),
		Display: session.DisplayMetadata{Label: name}, AccessMode: access,
		Runtime: owned, RootLease: rootLease,
	})
	if err != nil {
		return nil, ErrActivation
	}
	candidate.snapshot = snapshot
	candidate.runtime = owned
	candidate.staged = staged
	candidate.stagedSet = true
	return candidate, nil
}

func validRecoveryToken(value string) bool {
	if len(value) != 32 {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'f') && (char < '0' || char > '9') {
			return false
		}
	}
	return true
}

func safePendingLibraryPhase(value workspace.PendingPhase) (PendingLibraryPhase, bool) {
	switch value {
	case workspace.PendingApproved:
		return PendingLibraryApproved, true
	case workspace.PendingMutating:
		return PendingLibraryMutating, true
	case workspace.PendingCommitted:
		return PendingLibraryCommitted, true
	default:
		return "", false
	}
}
