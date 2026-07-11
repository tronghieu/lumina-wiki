package secrets

import "context"

func (m *Manager) acquireReference(ctx context.Context, ref string) (func(), error) {
	m.mu.Lock()
	lock := m.locks[ref]
	if lock == nil {
		lock = &referenceLock{gate: make(chan struct{}, 1)}
		lock.gate <- struct{}{}
		m.locks[ref] = lock
	}
	lock.users++
	m.mu.Unlock()
	select {
	case <-ctx.Done():
		m.releaseReferenceUser(ref, lock)
		return nil, ctx.Err()
	case <-lock.gate:
		return func() {
			lock.gate <- struct{}{}
			m.releaseReferenceUser(ref, lock)
		}, nil
	}
}

func (m *Manager) releaseReferenceUser(ref string, lock *referenceLock) {
	m.mu.Lock()
	lock.users--
	if lock.users == 0 {
		delete(m.locks, ref)
	}
	m.mu.Unlock()
}

func (m *Manager) clearSessionLocked(ref string) {
	if old, ok := m.session[ref]; ok {
		zeroBytes(old)
		delete(m.session, ref)
	}
}

func (m *Manager) clearChallengesLocked(ref string) {
	for nonce, pending := range m.challenges {
		if pending.ref == ref {
			delete(m.challenges, nonce)
		}
	}
}

func (m *Manager) setKnown(ref string, status CredentialStatus) {
	m.mu.Lock()
	m.known[ref] = safeStatus(status)
	m.mu.Unlock()
}

func (m *Manager) invalidateKnown(ref string) {
	m.mu.Lock()
	delete(m.known, ref)
	m.mu.Unlock()
}
