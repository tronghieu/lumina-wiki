package secrets

import (
	"encoding/base64"
	"errors"
	"io"
	"time"
)

func challengeAllowed(status CredentialStatus) bool {
	return status == StatusLocked || status == StatusDenied || status == StatusUnavailable || status == StatusUnsupported
}

func (m *Manager) newChallenge(ref string, reason CredentialStatus) (*SessionChallenge, error) {
	now := m.clock()
	for range 8 {
		raw := make([]byte, nonceBytes)
		m.randomMu.Lock()
		_, err := io.ReadFull(m.random, raw)
		m.randomMu.Unlock()
		if err != nil {
			return nil, errors.New("create session confirmation challenge failed")
		}
		nonce := base64.RawURLEncoding.EncodeToString(raw)
		zeroBytes(raw)
		m.mu.Lock()
		if _, exists := m.challenges[nonce]; exists {
			m.mu.Unlock()
			continue
		}
		m.evictExpiredLocked(now)
		m.clearChallengesLocked(ref)
		for len(m.challenges) >= m.maxChallenges {
			m.evictOldestLocked()
		}
		m.sequence++
		expiresAt := now.Add(m.ttl)
		m.challenges[nonce] = pendingChallenge{ref: ref, reason: reason, expiresAt: expiresAt, sequence: m.sequence}
		m.mu.Unlock()
		return &SessionChallenge{Nonce: nonce, Reason: reason, ExpiresAt: expiresAt}, nil
	}
	return nil, errors.New("create session confirmation challenge failed")
}

func (m *Manager) evictExpiredLocked(now time.Time) {
	for nonce, pending := range m.challenges {
		if !now.Before(pending.expiresAt) {
			delete(m.challenges, nonce)
		}
	}
}

func (m *Manager) evictOldestLocked() {
	var oldest string
	var sequence uint64
	for nonce, pending := range m.challenges {
		if oldest == "" || pending.sequence < sequence {
			oldest, sequence = nonce, pending.sequence
		}
	}
	if oldest != "" {
		delete(m.challenges, oldest)
	}
}
