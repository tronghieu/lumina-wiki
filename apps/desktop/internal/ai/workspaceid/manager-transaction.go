package workspaceid

import (
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"os"
	"sync"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

type preparedAttachStatus uint8

const (
	preparedAttachPending preparedAttachStatus = iota
	preparedAttachApproved
	preparedAttachCommitted
	preparedAttachAborted
)

type preparedAttachState struct {
	mu sync.Mutex

	manager       *Manager
	candidate     ownedCandidate
	proof         rootproof.RootProof
	rootLease     *os.Root
	workspaceID   WorkspaceID
	kind          AttachKind
	revision      string
	targetIDs     []WorkspaceID
	token         string
	expiresAt     time.Time
	status        preparedAttachStatus
	leaseTaken    bool
	handleAdopted bool
}

// PreparedAttach owns an uncommitted identity candidate and trusted root lease.
// Copies share one state, making terminal operations replay-safe.
type PreparedAttach struct {
	state *preparedAttachState
}

func (m *Manager) BeginAttachTrusted(root string, proof rootproof.RootProof) (*PreparedAttach, AttachDecision, error) {
	if err := m.validate(); err != nil {
		return nil, AttachDecision{}, err
	}
	if proof.Version() != rootproof.CurrentVersion || proof.Path() == "" || proof.Validate() != nil {
		return nil, AttachDecision{}, ErrCandidateChanged
	}
	candidate, err := resolveOwnedCandidate(root, m.canonicalize, m.openDirectory, m.handleSignature, m.probe)
	if err != nil {
		return nil, AttachDecision{}, err
	}
	closeCandidate := true
	defer func() {
		if closeCandidate {
			_ = candidate.handle.Close()
		}
	}()
	rootLease, err := proof.OpenRoot()
	if err != nil {
		return nil, AttachDecision{}, ErrCandidateChanged
	}
	closeLease := true
	defer func() {
		if closeLease {
			_ = rootLease.Close()
		}
	}()
	if err := sameCandidateAndRoot(candidate, rootLease); err != nil {
		return nil, AttachDecision{}, err
	}

	registry, revision, err := m.store.LoadSnapshot()
	if err != nil {
		return nil, AttachDecision{}, err
	}
	kind, index := classifyCandidate(registry, candidate.Candidate, candidateLegacy(candidate)...)
	if kind == AttachIdentityConfirmationRequired && index >= 0 &&
		m.isTrusted(registry.Records[index].WorkspaceID, candidate) {
		kind = AttachKnown
	}
	var id WorkspaceID
	switch kind {
	case AttachKnown, AttachIdentityConfirmationRequired, AttachRenameConfirmationRequired:
		if index < 0 {
			return nil, AttachDecision{}, ErrRegistryConflict
		}
		id = registry.Records[index].WorkspaceID
	case AttachNew, AttachPathReuseConfirmationRequired, AttachAmbiguousConfirmationRequired:
		id, err = m.newUniqueID(registry)
		if err != nil {
			return nil, AttachDecision{}, err
		}
	default:
		return nil, AttachDecision{}, ErrRegistryConflict
	}
	token, err := m.newDecisionToken()
	if err != nil {
		return nil, AttachDecision{}, err
	}
	now := m.clock()
	state := &preparedAttachState{
		manager: m, candidate: candidate, proof: proof, rootLease: rootLease, workspaceID: id,
		kind: kind, revision: revision,
		targetIDs: matchedWorkspaceIDs(registry, candidate.Candidate, candidateLegacy(candidate)...),
		token:     token, expiresAt: now.Add(m.ttl), status: preparedAttachPending,
	}
	m.mu.Lock()
	m.prepared[state] = struct{}{}
	m.mu.Unlock()
	closeCandidate, closeLease = false, false
	return &PreparedAttach{state: state}, AttachDecision{
		Kind: kind, Token: token, CanonicalPath: candidate.CanonicalPath, ExpiresAt: state.expiresAt,
	}, nil
}

func (m *Manager) newDecisionToken() (string, error) {
	for range 8 {
		raw := make([]byte, 32)
		m.randomMu.Lock()
		err := m.random(raw)
		m.randomMu.Unlock()
		if err != nil {
			return "", errors.New("create workspace confirmation failed")
		}
		token := base64.RawURLEncoding.EncodeToString(raw)
		for index := range raw {
			raw[index] = 0
		}
		if validDecisionToken(token) {
			return token, nil
		}
	}
	return "", errors.New("create workspace confirmation failed")
}

func sameCandidateAndRoot(candidate ownedCandidate, root *os.Root) error {
	if root == nil {
		return ErrCandidateChanged
	}
	candidateInfo, err := candidate.handle.Stat()
	if err != nil || candidateInfo == nil || !candidateInfo.IsDir() {
		return ErrCandidateChanged
	}
	rootHandle, err := root.Open(".")
	if err != nil {
		return ErrCandidateChanged
	}
	defer rootHandle.Close()
	rootInfo, err := rootHandle.Stat()
	if err != nil || rootInfo == nil || !rootInfo.IsDir() ||
		!sameDirectoryHandles(candidate.handle, rootHandle) {
		return ErrCandidateChanged
	}
	return revalidateHandle(candidate)
}

func (prepared *PreparedAttach) WorkspaceID() WorkspaceID {
	if prepared == nil || prepared.state == nil {
		return ""
	}
	prepared.state.mu.Lock()
	defer prepared.state.mu.Unlock()
	if prepared.state.status == preparedAttachAborted {
		return ""
	}
	return prepared.state.workspaceID
}

func (prepared *PreparedAttach) Approve(token string) error {
	if prepared == nil || prepared.state == nil || !validDecisionToken(token) {
		return ErrInvalidDecisionToken
	}
	state := prepared.state
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.status != preparedAttachPending {
		return ErrInvalidDecisionToken
	}
	expected := state.token
	state.token = ""
	if subtle.ConstantTimeCompare([]byte(token), []byte(expected)) != 1 ||
		!state.manager.clock().Before(state.expiresAt) {
		state.abortLocked()
		return ErrInvalidDecisionToken
	}
	if state.proof.Validate() != nil || sameCandidateAndRoot(state.candidate, state.rootLease) != nil {
		state.abortLocked()
		return ErrCandidateChanged
	}
	state.status = preparedAttachApproved
	return nil
}

func (prepared *PreparedAttach) TrustedRootIdentity() (os.FileInfo, error) {
	if prepared == nil || prepared.state == nil {
		return nil, ErrPreparedAttach
	}
	state := prepared.state
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.status != preparedAttachApproved || state.rootLease == nil || state.leaseTaken {
		return nil, ErrPreparedAttach
	}
	if state.proof.Validate() != nil || sameCandidateAndRoot(state.candidate, state.rootLease) != nil {
		return nil, ErrCandidateChanged
	}
	info, err := state.candidate.handle.Stat()
	if err != nil || info == nil || !info.IsDir() {
		return nil, ErrCandidateChanged
	}
	return info, nil
}

func (prepared *PreparedAttach) TakeRootLease() (*os.Root, error) {
	if prepared == nil || prepared.state == nil {
		return nil, ErrPreparedAttach
	}
	state := prepared.state
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.status != preparedAttachApproved || state.rootLease == nil || state.leaseTaken {
		return nil, ErrPreparedAttach
	}
	if state.proof.Validate() != nil || sameCandidateAndRoot(state.candidate, state.rootLease) != nil {
		return nil, ErrCandidateChanged
	}
	lease := state.rootLease
	state.rootLease = nil
	state.leaseTaken = true
	return lease, nil
}

func (prepared *PreparedAttach) Commit() error {
	if prepared == nil || prepared.state == nil {
		return ErrPreparedAttach
	}
	state := prepared.state
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.status == preparedAttachCommitted {
		return nil
	}
	if state.status != preparedAttachApproved || !state.leaseTaken {
		return ErrPreparedAttach
	}
	if state.proof.Validate() != nil || revalidateHandle(state.candidate) != nil {
		return ErrCandidateChanged
	}
	manager := state.manager
	manager.commitMu.Lock()
	defer manager.commitMu.Unlock()
	release, err := manager.store.acquireLock()
	if err != nil {
		return err
	}
	defer release()
	registry, revision, err := manager.store.LoadSnapshot()
	if err != nil {
		return err
	}
	current := state.candidate.Candidate
	if revision != state.revision ||
		!sameWorkspaceIDs(matchedWorkspaceIDs(registry, current, candidateLegacy(state.candidate)...), state.targetIDs) {
		return ErrRegistryConflict
	}
	kind, index := classifyCandidate(registry, current, candidateLegacy(state.candidate)...)
	if kind != state.kind && !(state.kind == AttachKnown && kind == AttachIdentityConfirmationRequired) {
		return ErrRegistryConflict
	}
	registry, err = commitPreparedRecord(registry, state.kind, index, current, state.workspaceID, manager.clock().UTC())
	if err != nil {
		return err
	}
	if err := manager.store.Save(registry); err != nil {
		return err
	}
	manager.adoptTrusted(state.workspaceID, state.candidate)
	state.handleAdopted = true
	state.status = preparedAttachCommitted
	state.untrackLocked()
	return nil
}

func commitPreparedRecord(registry Registry, kind AttachKind, index int, candidate Candidate,
	id WorkspaceID, now time.Time) (Registry, error) {
	switch kind {
	case AttachKnown, AttachIdentityConfirmationRequired:
		if index < 0 || registry.Records[index].WorkspaceID != id {
			return Registry{}, ErrRegistryConflict
		}
		registry.Records[index].LastSeenAt = now
		updateRecordSignature(&registry.Records[index], candidate)
	case AttachRenameConfirmationRequired:
		if index < 0 || registry.Records[index].WorkspaceID != id {
			return Registry{}, ErrRegistryConflict
		}
		registry.Records[index].CanonicalPath = candidate.CanonicalPath
		registry.Records[index].LastSeenAt = now
		updateRecordSignature(&registry.Records[index], candidate)
	case AttachNew, AttachPathReuseConfirmationRequired, AttachAmbiguousConfirmationRequired:
		var err error
		registry, err = makeRoomForRecord(registry)
		if err != nil {
			return Registry{}, err
		}
		for recordIndex := range registry.Records {
			if registry.Records[recordIndex].Active &&
				pathKey(registry.Records[recordIndex].CanonicalPath) == pathKey(candidate.CanonicalPath) {
				registry.Records[recordIndex].Active = false
				registry.Records[recordIndex].LastSeenAt = now
			}
		}
		signature := candidate.Signature
		if !candidate.HasSignature {
			signature = ""
		}
		registry.Records = append(registry.Records, Record{
			SchemaVersion: CurrentSchemaVersion, WorkspaceID: id, CanonicalPath: candidate.CanonicalPath,
			FilesystemSignature: signature, FirstSeenAt: now, LastSeenAt: now, Active: true,
		})
	default:
		return Registry{}, ErrRegistryConflict
	}
	return registry, nil
}

func (prepared *PreparedAttach) Abort() error {
	if prepared == nil || prepared.state == nil {
		return nil
	}
	state := prepared.state
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.status == preparedAttachCommitted || state.status == preparedAttachAborted {
		return nil
	}
	state.abortLocked()
	return nil
}

func (state *preparedAttachState) abortLocked() {
	state.status = preparedAttachAborted
	state.token = ""
	if !state.handleAdopted && state.candidate.handle != nil {
		_ = state.candidate.handle.Close()
		state.candidate.handle = nil
	}
	if state.rootLease != nil {
		_ = state.rootLease.Close()
		state.rootLease = nil
	}
	state.untrackLocked()
}

func (state *preparedAttachState) untrackLocked() {
	if state.manager == nil {
		return
	}
	state.manager.mu.Lock()
	delete(state.manager.prepared, state)
	state.manager.mu.Unlock()
}
