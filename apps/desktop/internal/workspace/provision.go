package workspace

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io/fs"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appprivate"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/contract"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

var (
	ErrInvalidProvisioner = errors.New("library provisioner is unavailable")
	ErrInvalidTarget      = errors.New("library target is invalid")
	ErrTargetNotCreatable = errors.New("library target cannot be created")
	ErrEmptyNeedsApproval = errors.New("empty library target requires approval")
	ErrPendingExists      = errors.New("another library operation needs attention")
	ErrPendingCorrupt     = errors.New("pending library operation is invalid")
	ErrRecoveryMismatch   = errors.New("library recovery request does not match")
	ErrProvisionState     = errors.New("library operation state is unavailable")
	ErrPublication        = errors.New("library publication failed safely")
)

type VerifiedMaterializer interface {
	Contract() contract.Contract
	Materialize(contract.RuntimeInputs) (contract.Materialized, error)
}

type ProvisionOptions struct {
	// AllowExistingEmpty is retained for source compatibility but is not
	// authority. Each empty-target operation must consume fresh approval.
	AllowExistingEmpty   bool
	ApproveExistingEmpty func(context.Context, string) error
	Now                  func() time.Time
	RandomID             func() (string, error)
	AfterStep            func(string) error
}

type ProvisionResult struct {
	Path       string
	RecoveryID string
	Root       rootproof.RootProof
	State      TargetState
}

type Provisioner struct {
	materializer VerifiedMaterializer
	contract     contract.Contract
	pending      *appprivate.Store
	gate         *appprivate.Store
	options      ProvisionOptions
}

func NewProvisioner(materializer VerifiedMaterializer, configBase string, options ProvisionOptions) (*Provisioner, error) {
	if materializer == nil {
		return nil, ErrInvalidProvisioner
	}
	view := materializer.Contract()
	if view.Versions.Contract != 1 || view.Payload.RootDigest == "" ||
		view.State.ManifestPath != "_lumina/manifest.json" {
		return nil, ErrInvalidProvisioner
	}
	pending, err := newPendingStore(configBase)
	if err != nil {
		return nil, ErrInvalidProvisioner
	}
	gate, err := appprivate.NewStore(configBase, "library-creation-gate", 1024)
	if err != nil {
		return nil, ErrInvalidProvisioner
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.RandomID == nil {
		options.RandomID = randomTransactionID
	}
	if options.AfterStep == nil {
		options.AfterStep = func(string) error { return nil }
	}
	return &Provisioner{
		materializer: materializer,
		contract:     view,
		pending:      pending,
		gate:         gate,
		options:      options,
	}, nil
}

func randomTransactionID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

func (p *Provisioner) Classify(ctx context.Context, target string) (TargetClassification, error) {
	var classification TargetClassification
	err := p.withCreationLock(ctx, func() error {
		var err error
		classification, err = p.classifyTarget(ctx, target)
		return err
	})
	return classification, err
}

func (p *Provisioner) classifyTarget(ctx context.Context, target string) (TargetClassification, error) {
	parentPath, child, err := validateTargetPath(target)
	if err != nil {
		return TargetClassification{State: TargetInvalid}, ErrInvalidTarget
	}
	parentProof, err := rootproof.Open(parentPath)
	if err != nil {
		return TargetClassification{State: TargetUnsafe}, ErrInvalidTarget
	}
	defer parentProof.Close()
	parentRoot, err := parentProof.OpenRoot()
	if err != nil {
		return TargetClassification{State: TargetUnsafe}, ErrInvalidTarget
	}
	defer parentRoot.Close()
	info, err := parentRoot.Lstat(child)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return TargetClassification{State: TargetUnsafe}, ErrInvalidTarget
		}
		return TargetClassification{State: TargetAbsent}, nil
	}
	if !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
		return TargetClassification{State: TargetOccupied}, nil
	}
	classification, err := classifyExistingRoot(ctx, target)
	if err != nil {
		return TargetClassification{}, err
	}
	if classification.State == TargetInterrupted {
		record, ok, pendingErr := p.readPending(ctx)
		if pendingErr != nil {
			return TargetClassification{}, pendingErr
		}
		if !ok || record.TargetPath != target {
			return TargetClassification{State: TargetDirty}, nil
		}
		if record.Phase == PendingCommitted {
			classification.State = TargetCommittedResidue
		}
	}
	return classification, nil
}

func (p *Provisioner) Provision(ctx context.Context, target string) (ProvisionResult, error) {
	var result ProvisionResult
	err := p.withCreationLock(ctx, func() error {
		var err error
		result, err = p.provisionLocked(ctx, target, pendingRecord{})
		return err
	})
	return result, err
}

func (p *Provisioner) RetryPending(ctx context.Context, recoveryID string) (ProvisionResult, error) {
	if !validRecoveryID(recoveryID) {
		return ProvisionResult{}, ErrRecoveryMismatch
	}
	var result ProvisionResult
	err := p.withCreationLock(ctx, func() error {
		record, ok, err := p.readPending(ctx)
		if err != nil {
			return err
		}
		if !ok || record.RecoveryID != recoveryID {
			return ErrRecoveryMismatch
		}
		result, err = p.provisionLocked(ctx, record.TargetPath, record)
		return err
	})
	return result, err
}

func (p *Provisioner) withCreationLock(ctx context.Context, action func() error) error {
	var actionErr error
	invoked := false
	_, err := p.gate.Update(ctx, func(appprivate.Snapshot) (appprivate.Mutation, error) {
		invoked = true
		actionErr = action()
		if actionErr != nil {
			return appprivate.Mutation{}, actionErr
		}
		return appprivate.Mutation{Data: []byte("{\"version\":1}\n")}, nil
	})
	if actionErr != nil {
		return actionErr
	}
	if err != nil {
		// The store callback runs only while the cross-process lock is held.
		// Once the action completed, failure to refresh the advisory marker
		// cannot reverse a manifest-committed operation.
		if invoked {
			return nil
		}
		return ErrProvisionState
	}
	return nil
}

func (p *Provisioner) provisionLocked(ctx context.Context, target string, recovery pendingRecord) (ProvisionResult, error) {
	parentPath, child, err := validateTargetPath(target)
	if err != nil {
		return ProvisionResult{}, ErrInvalidTarget
	}
	parentProof, err := rootproof.Open(parentPath)
	if err != nil {
		return ProvisionResult{}, ErrInvalidTarget
	}
	defer parentProof.Close()
	parentSignature, ok := parentProof.Signature()
	if !ok {
		return ProvisionResult{}, ErrInvalidTarget
	}

	if recovery.RecoveryID == "" {
		if _, exists, err := p.readPending(ctx); err != nil {
			return ProvisionResult{}, err
		} else if exists {
			return ProvisionResult{}, ErrPendingExists
		}
		classification, err := p.classifyTarget(ctx, target)
		if err != nil {
			return ProvisionResult{}, err
		}
		if classification.State != TargetAbsent && classification.State != TargetEmpty {
			return ProvisionResult{}, ErrTargetNotCreatable
		}
		id, err := p.options.RandomID()
		if err != nil || !validRecoveryID(id) {
			return ProvisionResult{}, ErrProvisionState
		}
		recovery = pendingRecord{
			Version:         1,
			RecoveryID:      id,
			Phase:           PendingApproved,
			ParentPath:      parentPath,
			ParentSignature: parentSignature,
			Child:           child,
			TargetPath:      target,
			ProjectName:     child,
			Now:             p.options.Now().UTC(),
			ContractDigest:  p.contract.Payload.RootDigest,
			JournalName:     provisionJournalPrefix + id + ".json",
			ApprovedState:   classification.State,
		}
		if classification.State == TargetEmpty {
			emptyProof, proofErr := rootproof.Open(target)
			if proofErr != nil {
				return ProvisionResult{}, ErrTargetNotCreatable
			}
			recovery.TargetSignature, ok = emptyProof.Signature()
			_ = emptyProof.Close()
			if !ok {
				return ProvisionResult{}, ErrTargetNotCreatable
			}
			if p.options.ApproveExistingEmpty == nil ||
				p.options.ApproveExistingEmpty(ctx, target) != nil {
				return ProvisionResult{}, ErrEmptyNeedsApproval
			}
		}
		if err := p.writePending(ctx, recovery); err != nil {
			return ProvisionResult{}, err
		}
		if err := p.options.AfterStep("pending:approved"); err != nil {
			return ProvisionResult{}, err
		}
	} else if recovery.ParentPath != parentPath || recovery.Child != child ||
		recovery.ParentSignature != parentSignature ||
		recovery.ContractDigest != p.contract.Payload.RootDigest {
		return ProvisionResult{}, ErrRecoveryMismatch
	}

	parentRoot, err := parentProof.OpenRoot()
	if err != nil {
		return ProvisionResult{}, ErrInvalidTarget
	}
	defer parentRoot.Close()
	info, statErr := parentRoot.Lstat(child)
	if isNotExist(statErr) {
		if recovery.ApprovedState != TargetAbsent || recovery.TargetSignature != "" {
			return ProvisionResult{}, ErrRecoveryMismatch
		}
		if err := parentRoot.Mkdir(child, 0o700); err != nil {
			return ProvisionResult{}, ErrPublication
		}
		info, statErr = parentRoot.Lstat(child)
	} else if recovery.ApprovedState == TargetAbsent && recovery.TargetSignature == "" {
		return ProvisionResult{}, ErrRecoveryMismatch
	}
	if statErr != nil || !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
		return ProvisionResult{}, ErrPublication
	}
	targetProof, err := rootproof.Open(target)
	if err != nil {
		return ProvisionResult{}, ErrPublication
	}
	keepProof := false
	defer func() {
		if !keepProof {
			_ = targetProof.Close()
		}
	}()
	targetSignature, ok := targetProof.Signature()
	if !ok || (recovery.TargetSignature != "" && recovery.TargetSignature != targetSignature) {
		return ProvisionResult{}, ErrRecoveryMismatch
	}
	if recovery.TargetSignature == "" {
		recovery.TargetSignature = targetSignature
		if err := p.writePending(ctx, recovery); err != nil {
			return ProvisionResult{}, err
		}
	}
	classification, err := classifyExistingRoot(ctx, target)
	if err != nil {
		return ProvisionResult{}, err
	}
	switch recovery.Phase {
	case PendingApproved:
		if classification.State != TargetEmpty {
			return ProvisionResult{}, ErrRecoveryMismatch
		}
	case PendingMutating:
		if classification.State != TargetEmpty && classification.State != TargetInterrupted && classification.State != TargetDirty &&
			classification.State != TargetMalformed {
			return ProvisionResult{}, ErrRecoveryMismatch
		}
	case PendingCommitted:
		if classification.State != TargetCompatible && classification.State != TargetInterrupted &&
			classification.State != TargetDirty {
			return ProvisionResult{}, ErrRecoveryMismatch
		}
	}

	materialized, err := p.materializer.Materialize(contract.RuntimeInputs{
		ProjectName: recovery.ProjectName,
		Now:         recovery.Now,
		Root:        targetProof,
	})
	if err != nil {
		return ProvisionResult{}, ErrInvalidProvisioner
	}
	if recovery.Phase == PendingCommitted {
		journal := buildJournal(recovery, materialized)
		if validateCommittedEvidence(targetProof, recovery, journal) == nil {
			_, _ = NewService().ValidateTrusted(ctx, target, targetProof)
		}
		keepProof = true
		return ProvisionResult{
			Path: target, RecoveryID: recovery.RecoveryID, Root: targetProof,
			State: TargetCommittedResidue,
		}, nil
	}
	recovery.Phase = PendingMutating
	if err := p.writePending(ctx, recovery); err != nil {
		return ProvisionResult{}, err
	}
	if err := p.options.AfterStep("pending:mutating"); err != nil {
		return ProvisionResult{}, err
	}
	publication, err := p.publishMaterialized(ctx, targetProof, recovery, materialized)
	if err != nil {
		return ProvisionResult{}, err
	}
	if !publication.committed {
		return ProvisionResult{}, ErrPublication
	}
	// Recovery evidence is intentionally retained. Supported platforms do not
	// offer one portable identity-atomic primitive for deleting both the held
	// transaction directory and its journal without a path replacement race.
	if publication.verified {
		_, _ = NewService().ValidateTrusted(context.Background(), target, targetProof)
	}
	recovery.Phase = PendingCommitted
	if err := p.writePending(context.Background(), recovery); err != nil {
		keepProof = true
		return ProvisionResult{
			Path: target, RecoveryID: recovery.RecoveryID, Root: targetProof,
			State: TargetCommittedResidue,
		}, nil
	}
	keepProof = true
	return ProvisionResult{
		Path:       target,
		RecoveryID: recovery.RecoveryID,
		Root:       targetProof,
		State:      TargetCommittedResidue,
	}, nil
}

func isNotExist(err error) bool {
	return errors.Is(err, fs.ErrNotExist)
}
