package secrets

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"
)

const (
	MaxCredentialRefBytes = 128
	MaxSecretBytes        = 2048
)

type CredentialStatus string

const (
	StatusMissing     CredentialStatus = "missing"
	StatusPersisted   CredentialStatus = "persisted"
	StatusSessionOnly CredentialStatus = "session_only"
	StatusLocked      CredentialStatus = "locked"
	StatusDenied      CredentialStatus = "denied"
	StatusUnavailable CredentialStatus = "unavailable"
	StatusUnsupported CredentialStatus = "unsupported"
	StatusFailure     CredentialStatus = "failure"
)

type SecretStore interface {
	Put(context.Context, string, []byte) error
	Get(context.Context, string) ([]byte, error)
	Delete(context.Context, string) error
	Status(context.Context, string) (CredentialStatus, error)
}

type StoreError struct {
	operation string
	status    CredentialStatus
}

func (e *StoreError) Error() string {
	return fmt.Sprintf("secure credential store %s failed (%s)", safeOperation(e.operation), safeStatus(e.status))
}

func (e *StoreError) Operation() string        { return safeOperation(e.operation) }
func (e *StoreError) Status() CredentialStatus { return safeStatus(e.status) }
func newStoreError(operation string, status CredentialStatus) *StoreError {
	return &StoreError{operation: safeOperation(operation), status: safeStatus(status)}
}

type DeleteError struct {
	sessionDeleted    bool
	persistentDeleted bool
	persistentStatus  CredentialStatus
	cause             error
}

func (e *DeleteError) Error() string {
	return fmt.Sprintf("credential delete partially failed (%s)", safeStatus(e.persistentStatus))
}

func (e *DeleteError) SessionDeleted() bool               { return e.sessionDeleted }
func (e *DeleteError) PersistentDeleted() bool            { return e.persistentDeleted }
func (e *DeleteError) PersistentStatus() CredentialStatus { return safeStatus(e.persistentStatus) }
func (e *DeleteError) Unwrap() error                      { return e.cause }
func newDeleteError(sessionDeleted bool, status CredentialStatus) *DeleteError {
	return newDeleteErrorWithCause(sessionDeleted, false, status, nil)
}
func newDeleteErrorWithCause(sessionDeleted, persistentDeleted bool, status CredentialStatus, cause error) *DeleteError {
	return &DeleteError{sessionDeleted: sessionDeleted, persistentDeleted: persistentDeleted,
		persistentStatus: safeStatus(status), cause: safeContextCause(cause)}
}
func safeContextCause(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return nil
}

type SaveDisposition string

const (
	SavePersisted                   SaveDisposition = "persisted"
	SaveSessionConfirmationRequired SaveDisposition = "session_confirmation_required"
)

type SessionChallenge struct {
	Nonce     string           `json:"nonce"`
	Reason    CredentialStatus `json:"reason"`
	ExpiresAt time.Time        `json:"expiresAt"`
}

type SaveResult struct {
	Disposition SaveDisposition   `json:"disposition"`
	Challenge   *SessionChallenge `json:"challenge,omitempty"`
}

var credentialRefPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

func validateCredentialRef(ref string) error {
	if len(ref) > MaxCredentialRefBytes || !credentialRefPattern.MatchString(ref) {
		return errors.New("credential reference must use 1-128 safe characters")
	}
	return nil
}

func validateSecret(secret []byte) error {
	if len(secret) == 0 || len(secret) > MaxSecretBytes {
		return errors.New("credential secret must be non-empty and within the portable size limit")
	}
	return nil
}

func safeOperation(operation string) string {
	switch operation {
	case "save", "load", "delete", "status":
		return operation
	default:
		return "operation"
	}
}

func statusFromError(err error) CredentialStatus {
	var storeErr *StoreError
	if errors.As(err, &storeErr) {
		return storeErr.Status()
	}
	return StatusFailure
}

func safeStatus(status CredentialStatus) CredentialStatus {
	if isKnownStatus(status) {
		return status
	}
	return StatusFailure
}

func isKnownStatus(status CredentialStatus) bool {
	switch status {
	case StatusMissing, StatusPersisted, StatusSessionOnly, StatusLocked, StatusDenied, StatusUnavailable, StatusUnsupported, StatusFailure:
		return true
	default:
		return false
	}
}
