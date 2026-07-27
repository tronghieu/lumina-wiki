package secrets

import (
	"context"
	"errors"
	"runtime"
	"strings"

	keyring "github.com/zalando/go-keyring"
)

const keyringService = "lumina-wiki-desktop"

type keyringBackend interface {
	Set(service, user, password string) error
	Get(service, user string) (string, error)
	Delete(service, user string) error
}

type systemKeyring struct{}

func (systemKeyring) Set(service, user, password string) error {
	return keyring.Set(service, user, password)
}
func (systemKeyring) Get(service, user string) (string, error) { return keyring.Get(service, user) }
func (systemKeyring) Delete(service, user string) error        { return keyring.Delete(service, user) }

// KeyringStore checks cancellation before and after each upstream call.
// go-keyring v0.2.8 is synchronous and cannot interrupt an in-flight OS call;
// no goroutine is spawned, avoiding unbounded background work.
type KeyringStore struct{ backend keyringBackend }

func NewKeyringStore() *KeyringStore { return newKeyringStore(systemKeyring{}) }

func newKeyringStore(backend keyringBackend) *KeyringStore { return &KeyringStore{backend: backend} }

func (s *KeyringStore) Put(ctx context.Context, ref string, secret []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateCredentialRef(ref); err != nil {
		return err
	}
	if err := validateSecret(secret); err != nil {
		return err
	}
	// go-keyring requires immutable strings. Owned byte buffers are zeroed where
	// possible, but upstream/runtime control the lifetime of these string copies.
	err := s.backend.Set(keyringService, ref, string(secret))
	if err == nil {
		// Mutation completion wins cancellation: the OS keyring already changed.
		return nil
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if err != nil {
		return mapKeyringError("save", err)
	}
	return nil
}

func (s *KeyringStore) Get(ctx context.Context, ref string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateCredentialRef(ref); err != nil {
		return nil, err
	}
	value, err := s.backend.Get(keyringService, ref)
	owned := []byte(value)
	if ctxErr := ctx.Err(); ctxErr != nil {
		zeroBytes(owned)
		return nil, ctxErr
	}
	if err != nil {
		zeroBytes(owned)
		return nil, mapKeyringError("load", err)
	}
	if err := validateSecret(owned); err != nil {
		zeroBytes(owned)
		return nil, err
	}
	return owned, nil
}

func (s *KeyringStore) Delete(ctx context.Context, ref string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validateCredentialRef(ref); err != nil {
		return err
	}
	err := s.backend.Delete(keyringService, ref)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	if err == nil {
		// Mutation completion wins cancellation: deletion already committed.
		return nil
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if err != nil {
		return mapKeyringError("delete", err)
	}
	return nil
}

// Status is an interactive Get probe because go-keyring has no existence-only
// API. It may prompt and must not be polled. Context is checked around, but
// cannot interrupt, the upstream synchronous OS call.
func (s *KeyringStore) Status(ctx context.Context, ref string) (CredentialStatus, error) {
	secret, err := s.Get(ctx, ref)
	zeroBytes(secret)
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return StatusFailure, err
	}
	if err == nil {
		return StatusPersisted, nil
	}
	status := statusFromError(err)
	if status == StatusMissing {
		return StatusMissing, nil
	}
	return status, newStoreError("status", status)
}

func mapKeyringError(operation string, err error) error {
	status := classifyKeyringError(err)
	return newStoreError(operation, status)
}

func classifyKeyringError(err error) CredentialStatus {
	if errors.Is(err, keyring.ErrNotFound) {
		return StatusMissing
	}
	if errors.Is(err, keyring.ErrUnsupportedPlatform) {
		return StatusUnsupported
	}
	if status := classifyPlatformKeyringError(err, runtime.GOOS); status != StatusFailure {
		return status
	}
	message := strings.ToLower(err.Error())
	if containsAny(message, "locked", "interaction not allowed") {
		return StatusLocked
	}
	if containsAny(message, "permission denied", "access denied", "not authorized", "authorization denied", "user canceled", "user cancelled") {
		return StatusDenied
	}
	if containsAny(message, "unavailable", "not available", "no such file", "cannot autolaunch", "serviceunknown", "service unknown", "connection refused", "not running") {
		return StatusUnavailable
	}
	if containsAny(message, "unsupported platform", "not supported") {
		return StatusUnsupported
	}
	return StatusFailure
}

func containsAny(value string, markers ...string) bool {
	for _, marker := range markers {
		if strings.Contains(value, marker) {
			return true
		}
	}
	return false
}
