package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appprivate"
)

const maxPendingBytes = 128 * 1024

type PendingPhase string

const (
	PendingApproved  PendingPhase = "approved"
	PendingMutating  PendingPhase = "mutating"
	PendingCommitted PendingPhase = "committed"
)

type PendingLibraryOperation struct {
	RecoveryID string
	Name       string
	Phase      PendingPhase
}

type pendingRecord struct {
	ApprovedState   TargetState  `json:"approvedState"`
	Child           string       `json:"child"`
	ContractDigest  string       `json:"contractDigest"`
	JournalName     string       `json:"journalName"`
	Now             time.Time    `json:"now"`
	ParentPath      string       `json:"parentPath"`
	ParentSignature string       `json:"parentSignature"`
	Phase           PendingPhase `json:"phase"`
	ProjectName     string       `json:"projectName"`
	RecoveryID      string       `json:"recoveryId"`
	TargetPath      string       `json:"targetPath"`
	TargetSignature string       `json:"targetSignature,omitempty"`
	Version         int          `json:"version"`
}

func newPendingStore(configBase string) (*appprivate.Store, error) {
	return appprivate.NewStore(configBase, "pending-library-operation", maxPendingBytes)
}

func encodePending(record pendingRecord) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(record); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func decodePending(raw []byte) (pendingRecord, error) {
	var record pendingRecord
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&record); err != nil {
		return pendingRecord{}, ErrPendingCorrupt
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return pendingRecord{}, ErrPendingCorrupt
	}
	if record.Version != 1 || !validRecoveryID(record.RecoveryID) ||
		record.ProjectName == "" || record.ParentPath == "" || record.TargetPath == "" ||
		record.Child == "" || record.ContractDigest == "" || record.JournalName == "" ||
		(record.ApprovedState != TargetAbsent && record.ApprovedState != TargetEmpty) ||
		(record.Phase != PendingApproved && record.Phase != PendingMutating && record.Phase != PendingCommitted) {
		return pendingRecord{}, ErrPendingCorrupt
	}
	return record, nil
}

func (p *Provisioner) readPending(ctx context.Context) (pendingRecord, bool, error) {
	snapshot, err := p.pending.Read(ctx)
	if err != nil {
		return pendingRecord{}, false, ErrProvisionState
	}
	if !snapshot.Exists {
		return pendingRecord{}, false, nil
	}
	record, err := decodePending(snapshot.Data)
	if err != nil {
		return pendingRecord{}, false, err
	}
	return record, true, nil
}

func (p *Provisioner) writePending(ctx context.Context, record pendingRecord) error {
	raw, err := encodePending(record)
	if err != nil {
		return ErrProvisionState
	}
	if err := p.pending.Write(ctx, raw); err != nil {
		return ErrProvisionState
	}
	return nil
}

func (p *Provisioner) PendingOperation(ctx context.Context) (PendingLibraryOperation, bool, error) {
	record, ok, err := p.readPending(ctx)
	if err != nil || !ok {
		return PendingLibraryOperation{}, ok, err
	}
	return PendingLibraryOperation{
		RecoveryID: record.RecoveryID,
		Name:       record.ProjectName,
		Phase:      record.Phase,
	}, true, nil
}

func (p *Provisioner) RemovePending(ctx context.Context, recoveryID string) error {
	if !validRecoveryID(recoveryID) {
		return ErrRecoveryMismatch
	}
	_, err := p.pending.Update(ctx, func(snapshot appprivate.Snapshot) (appprivate.Mutation, error) {
		if !snapshot.Exists {
			return appprivate.Mutation{}, ErrRecoveryMismatch
		}
		record, err := decodePending(snapshot.Data)
		if err != nil {
			return appprivate.Mutation{}, err
		}
		if record.RecoveryID != recoveryID {
			return appprivate.Mutation{}, ErrRecoveryMismatch
		}
		return appprivate.Mutation{Delete: true}, nil
	})
	if err != nil {
		if errors.Is(err, ErrRecoveryMismatch) || errors.Is(err, ErrPendingCorrupt) {
			return err
		}
		return ErrProvisionState
	}
	return nil
}

func validRecoveryID(value string) bool {
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
