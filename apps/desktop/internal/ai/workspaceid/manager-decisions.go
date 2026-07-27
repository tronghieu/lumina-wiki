package workspaceid

import (
	"encoding/base64"
	"errors"
	"path/filepath"
	"time"
	"unicode"
	"unicode/utf8"
)

func (m *Manager) BeginAttach(root string) (AttachDecision, error) {
	if err := m.validate(); err != nil {
		return AttachDecision{}, err
	}
	candidate, err := resolveOwnedCandidate(root, m.canonicalize, m.openDirectory, m.handleSignature, m.probe)
	if err != nil {
		return AttachDecision{}, err
	}
	registry, revision, err := m.store.LoadSnapshot()
	if err != nil {
		_ = candidate.handle.Close()
		return AttachDecision{}, err
	}
	kind, index := classifyCandidate(registry, candidate.Candidate, candidateLegacy(candidate)...)
	if kind == AttachIdentityConfirmationRequired && index >= 0 && m.isTrusted(registry.Records[index].WorkspaceID, candidate) {
		kind = AttachKnown
	}
	return m.issueDecision(candidate, kind, revision,
		matchedWorkspaceIDs(registry, candidate.Candidate, candidateLegacy(candidate)...))
}

func (m *Manager) ResolveRecent(ids []WorkspaceID) ([]RecentWorkspace, error) {
	if err := m.validate(); err != nil {
		return nil, err
	}
	if len(ids) > MaxRecentWorkspaces {
		return nil, ErrInvalidRecentWorkspace
	}
	seen := make(map[WorkspaceID]struct{}, len(ids))
	for _, id := range ids {
		if !id.Valid() {
			return nil, ErrInvalidRecentWorkspace
		}
		if _, exists := seen[id]; exists {
			return nil, ErrInvalidRecentWorkspace
		}
		seen[id] = struct{}{}
	}
	registry, _, err := m.store.LoadSnapshot()
	if err != nil {
		return nil, err
	}
	active := make(map[WorkspaceID]Record, len(registry.Records))
	for _, record := range registry.Records {
		if record.Active {
			active[record.WorkspaceID] = record
		}
	}
	recent := make([]RecentWorkspace, 0, len(ids))
	for _, id := range ids {
		record, exists := active[id]
		if !exists {
			continue
		}
		label := safeRecentLabel(filepath.Base(record.CanonicalPath))
		recent = append(recent, RecentWorkspace{
			WorkspaceID: id,
			Label:       label,
			LastSeenAt:  record.LastSeenAt,
		})
	}
	return recent, nil
}

func (m *Manager) BeginRestore(id WorkspaceID) (AttachDecision, error) {
	if err := m.validate(); err != nil {
		return AttachDecision{}, err
	}
	if !id.Valid() {
		return AttachDecision{}, ErrInvalidRecentWorkspace
	}
	registry, revision, err := m.store.LoadSnapshot()
	if err != nil {
		return AttachDecision{}, err
	}
	recordIndex := -1
	for index, record := range registry.Records {
		if record.WorkspaceID == id {
			recordIndex = index
			break
		}
	}
	if recordIndex < 0 {
		return AttachDecision{}, ErrRecentWorkspaceUnknown
	}
	if !registry.Records[recordIndex].Active {
		return AttachDecision{}, ErrRecentWorkspaceInactive
	}
	candidate, err := resolveOwnedCandidate(
		registry.Records[recordIndex].CanonicalPath,
		m.canonicalize,
		m.openDirectory,
		m.handleSignature,
		m.probe,
	)
	if err != nil {
		if errors.Is(err, ErrCandidateChanged) {
			return AttachDecision{}, ErrRecentWorkspaceChanged
		}
		return AttachDecision{}, ErrRecentWorkspaceUnavailable
	}
	kind, index := classifyCandidate(registry, candidate.Candidate, candidateLegacy(candidate)...)
	if kind == AttachIdentityConfirmationRequired && index >= 0 && m.isTrusted(id, candidate) {
		kind = AttachKnown
	}
	targetIDs := matchedWorkspaceIDs(registry, candidate.Candidate, candidateLegacy(candidate)...)
	if !restoreDecisionTargets(kind, index, id, registry, targetIDs) {
		_ = candidate.handle.Close()
		return AttachDecision{}, ErrRecentWorkspaceChanged
	}
	return m.issueDecision(candidate, kind, revision, targetIDs)
}

func (m *Manager) BeginFind(id WorkspaceID, root string) (AttachDecision, error) {
	if err := m.validate(); err != nil {
		return AttachDecision{}, err
	}
	if !id.Valid() {
		return AttachDecision{}, ErrInvalidRecentWorkspace
	}
	registry, revision, err := m.store.LoadSnapshot()
	if err != nil {
		return AttachDecision{}, err
	}
	recordIndex := -1
	for index, record := range registry.Records {
		if record.WorkspaceID == id {
			recordIndex = index
			break
		}
	}
	if recordIndex < 0 {
		return AttachDecision{}, ErrRecentWorkspaceUnknown
	}
	if !registry.Records[recordIndex].Active {
		return AttachDecision{}, ErrRecentWorkspaceInactive
	}
	candidate, err := resolveOwnedCandidate(
		root, m.canonicalize, m.openDirectory, m.handleSignature, m.probe,
	)
	if err != nil {
		return AttachDecision{}, ErrRecentWorkspaceUnavailable
	}
	kind, index := classifyCandidate(registry, candidate.Candidate, candidateLegacy(candidate)...)
	if kind == AttachIdentityConfirmationRequired && index >= 0 && m.isTrusted(id, candidate) {
		kind = AttachKnown
	}
	targetIDs := matchedWorkspaceIDs(registry, candidate.Candidate, candidateLegacy(candidate)...)
	if !restoreDecisionTargets(kind, index, id, registry, targetIDs) {
		_ = candidate.handle.Close()
		return AttachDecision{}, ErrRecentWorkspaceChanged
	}
	return m.issueDecision(candidate, kind, revision, targetIDs)
}

func restoreDecisionTargets(
	kind AttachKind,
	index int,
	id WorkspaceID,
	registry Registry,
	targetIDs []WorkspaceID,
) bool {
	switch kind {
	case AttachKnown, AttachIdentityConfirmationRequired, AttachRenameConfirmationRequired:
	default:
		return false
	}
	if index < 0 || index >= len(registry.Records) || registry.Records[index].WorkspaceID != id {
		return false
	}
	return len(targetIDs) == 1 && targetIDs[0] == id
}

func safeRecentLabel(value string) string {
	if value == "" || value == "." || value == string(filepath.Separator) ||
		len(value) > MaxRecentLabelBytes || !utf8.ValidString(value) {
		return "Library"
	}
	for _, character := range value {
		if unicode.IsControl(character) || unicode.Is(unicode.Cf, character) {
			return "Library"
		}
	}
	return value
}

func (m *Manager) issueDecision(
	candidate ownedCandidate,
	kind AttachKind,
	revision string,
	targetIDs []WorkspaceID,
) (AttachDecision, error) {
	now := m.clock()
	for range 8 {
		raw := make([]byte, 32)
		m.randomMu.Lock()
		err := m.random(raw)
		m.randomMu.Unlock()
		if err != nil {
			_ = candidate.handle.Close()
			return AttachDecision{}, errors.New("create workspace confirmation failed")
		}
		token := base64.RawURLEncoding.EncodeToString(raw)
		for index := range raw {
			raw[index] = 0
		}
		m.mu.Lock()
		m.evictExpiredLocked(now)
		if _, exists := m.pending[token]; exists {
			m.mu.Unlock()
			continue
		}
		for len(m.pending) >= m.maxDecisions {
			m.evictOldestLocked()
		}
		m.sequence++
		expiresAt := now.Add(m.ttl)
		m.pending[token] = pendingDecision{candidate: candidate, kind: kind, revision: revision,
			targetIDs: targetIDs,
			expiresAt: expiresAt, sequence: m.sequence}
		m.mu.Unlock()
		return AttachDecision{Kind: kind, Token: token, CanonicalPath: candidate.CanonicalPath, ExpiresAt: expiresAt}, nil
	}
	_ = candidate.handle.Close()
	return AttachDecision{}, errors.New("create workspace confirmation failed")
}

func (m *Manager) CancelAttach(token string) error {
	if err := m.validate(); err != nil {
		return err
	}
	if !validDecisionToken(token) {
		return ErrInvalidDecisionToken
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	pending, exists := m.pending[token]
	if !exists || !m.clock().Before(pending.expiresAt) {
		if exists {
			_ = pending.candidate.handle.Close()
		}
		delete(m.pending, token)
		return ErrInvalidDecisionToken
	}
	delete(m.pending, token)
	_ = pending.candidate.handle.Close()
	return nil
}

func (m *Manager) takeDecision(token string) (pendingDecision, error) {
	if !validDecisionToken(token) {
		return pendingDecision{}, ErrInvalidDecisionToken
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	pending, exists := m.pending[token]
	// Every confirmation attempt is single-use, including candidate changes,
	// registry conflicts, busy locks, and persistence failures.
	delete(m.pending, token)
	if !exists || !m.clock().Before(pending.expiresAt) {
		if exists {
			_ = pending.candidate.handle.Close()
		}
		return pendingDecision{}, ErrInvalidDecisionToken
	}
	return pending, nil
}

func validDecisionToken(token string) bool {
	if len(token) != 43 {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(raw) == 32
}

func (m *Manager) evictExpiredLocked(now time.Time) {
	for token, pending := range m.pending {
		if !now.Before(pending.expiresAt) {
			_ = pending.candidate.handle.Close()
			delete(m.pending, token)
		}
	}
}

func (m *Manager) evictOldestLocked() {
	oldest, sequence := "", uint64(0)
	for token, pending := range m.pending {
		if oldest == "" || pending.sequence < sequence {
			oldest, sequence = token, pending.sequence
		}
	}
	if oldest != "" {
		_ = m.pending[oldest].candidate.handle.Close()
		delete(m.pending, oldest)
	}
}
