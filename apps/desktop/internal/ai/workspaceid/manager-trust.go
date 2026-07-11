package workspaceid

import "os"

func (m *Manager) isTrusted(id WorkspaceID, candidate ownedCandidate) bool {
	m.mu.Lock()
	trusted, exists := m.trusted[pathKey(candidate.CanonicalPath)]
	m.mu.Unlock()
	if !exists || trusted.id != id {
		return false
	}
	trustedInfo, err := trusted.handle.Stat()
	if err != nil {
		return false
	}
	candidateInfo, err := candidate.handle.Stat()
	return err == nil && os.SameFile(trustedInfo, candidateInfo)
}

func (m *Manager) adoptTrusted(id WorkspaceID, candidate ownedCandidate) {
	key := pathKey(candidate.CanonicalPath)
	m.mu.Lock()
	var stale []DirectoryHandle
	for oldKey, old := range m.trusted {
		if oldKey == key || old.id == id {
			stale = append(stale, old.handle)
			delete(m.trusted, oldKey)
		}
	}
	m.trusted[key] = trustedEvidence{id: id, handle: candidate.handle}
	m.mu.Unlock()
	for _, handle := range stale {
		if handle != candidate.handle {
			_ = handle.Close()
		}
	}
}

func (m *Manager) Close() error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for token, pending := range m.pending {
		_ = pending.candidate.handle.Close()
		delete(m.pending, token)
	}
	for key, trusted := range m.trusted {
		_ = trusted.handle.Close()
		delete(m.trusted, key)
	}
	return nil
}
