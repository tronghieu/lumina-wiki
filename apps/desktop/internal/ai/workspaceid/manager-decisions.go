package workspaceid

import (
	"encoding/base64"
	"errors"
	"time"
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
	kind, index := classifyCandidate(registry, candidate.Candidate)
	if kind == AttachIdentityConfirmationRequired && index >= 0 && m.isTrusted(registry.Records[index].WorkspaceID, candidate) {
		kind = AttachKnown
	}
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
			targetIDs: matchedWorkspaceIDs(registry, candidate.Candidate), expiresAt: expiresAt, sequence: m.sequence}
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
