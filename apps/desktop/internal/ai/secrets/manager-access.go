package secrets

import (
	"context"
	"errors"
)

func (m *Manager) Get(ctx context.Context, ref string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateCredentialRef(ref); err != nil {
		return nil, err
	}
	release, err := m.acquireReference(ctx, ref)
	if err != nil {
		return nil, err
	}
	defer release()
	m.mu.Lock()
	if secret, ok := m.session[ref]; ok {
		result := append([]byte(nil), secret...)
		m.mu.Unlock()
		return result, nil
	}
	m.mu.Unlock()
	secret, err := m.persistent.Get(ctx, ref)
	defer zeroBytes(secret)
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if err != nil {
		status := statusFromError(err)
		if status == StatusMissing {
			m.setKnown(ref, StatusMissing)
		} else {
			m.invalidateKnown(ref)
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, newStoreError("load", status)
	}
	if err := validateSecret(secret); err != nil {
		m.invalidateKnown(ref)
		return nil, err
	}
	m.setKnown(ref, StatusPersisted)
	return append([]byte(nil), secret...), nil
}

func (m *Manager) Delete(ctx context.Context, ref string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateCredentialRef(ref); err != nil {
		return err
	}
	release, err := m.acquireReference(ctx, ref)
	if err != nil {
		return err
	}
	defer release()
	m.mu.Lock()
	_, hadSession := m.session[ref]
	m.clearSessionLocked(ref)
	m.clearChallengesLocked(ref)
	delete(m.known, ref)
	m.mu.Unlock()
	storeErr := m.persistent.Delete(ctx, ref)
	if storeErr == nil {
		m.setKnown(ref, StatusMissing)
		return nil
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		m.invalidateKnown(ref)
		return newDeleteErrorWithCause(hadSession, false, statusFromError(storeErr), ctxErr)
	}
	if storeErr != nil {
		status := statusFromError(storeErr)
		if status == StatusMissing {
			m.setKnown(ref, StatusMissing)
			return nil
		}
		m.invalidateKnown(ref)
		if errors.Is(storeErr, context.Canceled) || errors.Is(storeErr, context.DeadlineExceeded) {
			return newDeleteErrorWithCause(hadSession, false, status, storeErr)
		}
		return newDeleteError(hadSession, status)
	}
	return nil
}

func (m *Manager) Status(ctx context.Context, ref string) (CredentialStatus, error) {
	if err := ctx.Err(); err != nil {
		return StatusFailure, err
	}
	if err := validateCredentialRef(ref); err != nil {
		return StatusFailure, err
	}
	release, err := m.acquireReference(ctx, ref)
	if err != nil {
		return StatusFailure, err
	}
	defer release()
	m.mu.Lock()
	if _, ok := m.session[ref]; ok {
		m.mu.Unlock()
		return StatusSessionOnly, nil
	}
	if status, ok := m.known[ref]; ok {
		m.mu.Unlock()
		return status, nil
	}
	m.mu.Unlock()
	status, err := m.persistent.Status(ctx, ref)
	if ctxErr := ctx.Err(); ctxErr != nil {
		m.invalidateKnown(ref)
		return StatusFailure, ctxErr
	}
	normalized := safeStatus(status)
	if !isKnownStatus(status) {
		m.invalidateKnown(ref)
		return StatusFailure, newStoreError("status", StatusFailure)
	}
	if err != nil {
		m.invalidateKnown(ref)
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return StatusFailure, err
		}
		return normalized, newStoreError("status", normalized)
	}
	m.setKnown(ref, normalized)
	return normalized, nil
}
