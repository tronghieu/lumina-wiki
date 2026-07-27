package workspaceid

import "os"

func (m *Manager) isTrusted(id WorkspaceID, candidate ownedCandidate) bool {
	m.mu.Lock()
	trusted, exists := m.trusted[pathKey(candidate.CanonicalPath)]
	if !exists || trusted.id != id {
		m.mu.Unlock()
		return false
	}
	m.mu.Unlock()
	return sameDirectoryHandles(trusted.handle, candidate.handle)
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
	var handles []DirectoryHandle
	for token, pending := range m.pending {
		handles = append(handles, pending.candidate.handle)
		delete(m.pending, token)
	}
	prepared := make([]*preparedAttachState, 0, len(m.prepared))
	for state := range m.prepared {
		prepared = append(prepared, state)
		delete(m.prepared, state)
	}
	for key, trusted := range m.trusted {
		handles = append(handles, trusted.handle)
		delete(m.trusted, key)
	}
	m.mu.Unlock()
	for _, state := range prepared {
		attach := &PreparedAttach{state: state}
		_ = attach.Abort()
	}
	for _, handle := range handles {
		_ = handle.Close()
	}
	return nil
}

func (m *Manager) TrustedRootIdentity(id WorkspaceID, canonicalPath string) (os.FileInfo, error) {
	if m == nil || !id.Valid() || !validCanonicalPath(canonicalPath) {
		return nil, ErrTrustedWorkspaceUnavailable
	}
	if err := m.validate(); err != nil {
		return nil, ErrTrustedWorkspaceUnavailable
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	trusted, exists := m.trusted[pathKey(canonicalPath)]
	if !exists || trusted.id != id || trusted.handle == nil {
		return nil, ErrTrustedWorkspaceUnavailable
	}
	info, err := trusted.handle.Stat()
	if err != nil || info == nil || !info.IsDir() {
		return nil, ErrTrustedWorkspaceUnavailable
	}
	return info, nil
}
