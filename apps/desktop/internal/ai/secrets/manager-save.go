package secrets

import (
	"context"
	"errors"
)

func (m *Manager) Save(ctx context.Context, ref string, secret []byte) (SaveResult, error) {
	if err := ctx.Err(); err != nil {
		return SaveResult{}, err
	}
	if err := validateCredentialRef(ref); err != nil {
		return SaveResult{}, err
	}
	if err := validateSecret(secret); err != nil {
		return SaveResult{}, err
	}
	release, err := m.acquireReference(ctx, ref)
	if err != nil {
		return SaveResult{}, err
	}
	defer release()
	storeErr := m.persistent.Put(ctx, ref, secret)
	if storeErr == nil {
		m.mu.Lock()
		m.clearSessionLocked(ref)
		m.clearChallengesLocked(ref)
		m.known[ref] = StatusPersisted
		m.mu.Unlock()
		return SaveResult{Disposition: SavePersisted}, nil
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return SaveResult{}, ctxErr
	}
	if errors.Is(storeErr, context.Canceled) || errors.Is(storeErr, context.DeadlineExceeded) {
		return SaveResult{}, storeErr
	}
	status := statusFromError(storeErr)
	if !challengeAllowed(status) {
		m.invalidateKnown(ref)
		return SaveResult{}, newStoreError("save", status)
	}
	challenge, err := m.newChallenge(ref, status)
	if err != nil {
		return SaveResult{}, err
	}
	return SaveResult{Disposition: SaveSessionConfirmationRequired, Challenge: challenge}, nil
}

func (m *Manager) ConfirmSessionCredential(ctx context.Context, nonce string, secret []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateSecret(secret); err != nil {
		return err
	}
	m.mu.Lock()
	pending, ok := m.challenges[nonce]
	m.mu.Unlock()
	if !ok {
		return errors.New("session confirmation failed")
	}
	release, err := m.acquireReference(ctx, pending.ref)
	if err != nil {
		return err
	}
	defer release()
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.clock()
	current, ok := m.challenges[nonce]
	if !ok || current.ref != pending.ref || !now.Before(current.expiresAt) {
		return errors.New("session confirmation failed")
	}
	m.clearChallengesLocked(pending.ref)
	m.clearSessionLocked(pending.ref)
	m.session[pending.ref] = append([]byte(nil), secret...)
	m.known[pending.ref] = StatusSessionOnly
	return nil
}
