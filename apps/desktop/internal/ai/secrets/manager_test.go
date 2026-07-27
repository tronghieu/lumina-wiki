package secrets

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeStore struct {
	mu          sync.Mutex
	values      map[string][]byte
	putStatus   CredentialStatus
	getStatus   CredentialStatus
	delStatus   CredentialStatus
	statusValue CredentialStatus
	statusErr   error
}

func (f *fakeStore) Put(_ context.Context, ref string, secret []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.putStatus != "" {
		return newStoreError("save", f.putStatus)
	}
	if f.values == nil {
		f.values = make(map[string][]byte)
	}
	f.values[ref] = append([]byte(nil), secret...)
	return nil
}

func (f *fakeStore) Get(_ context.Context, ref string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.getStatus != "" {
		return nil, newStoreError("load", f.getStatus)
	}
	secret, ok := f.values[ref]
	if !ok {
		return nil, newStoreError("load", StatusMissing)
	}
	return append([]byte(nil), secret...), nil
}

func (f *fakeStore) Delete(_ context.Context, ref string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.delStatus != "" {
		return newStoreError("delete", f.delStatus)
	}
	delete(f.values, ref)
	return nil
}

func (f *fakeStore) Status(_ context.Context, ref string) (CredentialStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.statusValue != "" || f.statusErr != nil {
		return f.statusValue, f.statusErr
	}
	if f.getStatus != "" {
		return f.getStatus, newStoreError("status", f.getStatus)
	}
	if _, ok := f.values[ref]; ok {
		return StatusPersisted, nil
	}
	return StatusMissing, nil
}

func TestManagerStatusSanitizesUnknownBackendStatus(t *testing.T) {
	ref := "provider:private-reference"
	rawStatus := CredentialStatus("custom-private-status")
	tests := []struct {
		name string
		err  error
	}{
		{"nil backend error", nil},
		{"custom backend error", errors.New("raw backend detail for " + ref)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &fakeStore{statusValue: rawStatus, statusErr: test.err}
			manager := newTestManager(t, store, &testClock{now: time.Unix(100, 0)}, bytes.NewReader(make([]byte, 64)), 4)
			status, err := manager.Status(context.Background(), ref)
			if status != StatusFailure {
				t.Fatalf("status = %q, want %q", status, StatusFailure)
			}
			var storeErr *StoreError
			if !errors.As(err, &storeErr) || storeErr.Status() != StatusFailure {
				t.Fatalf("error must agree with sanitized status: %T %v", err, err)
			}
			for _, forbidden := range []string{string(rawStatus), ref, "raw backend detail"} {
				if strings.Contains(err.Error(), forbidden) {
					t.Fatalf("status error leaked backend detail: %q", err)
				}
			}
		})
	}
}

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func newTestManager(t *testing.T, store SecretStore, clock *testClock, random io.Reader, cap int) *Manager {
	t.Helper()
	manager, err := NewManager(store, ManagerOptions{Clock: clock.Now, Random: random, ChallengeTTL: time.Minute, MaxChallenges: cap})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return manager
}

func TestManagerSavePersistsWithoutSessionChallenge(t *testing.T) {
	store := &fakeStore{}
	clock := &testClock{now: time.Unix(100, 0)}
	manager := newTestManager(t, store, clock, bytes.NewReader(make([]byte, 64)), 4)
	result, err := manager.Save(context.Background(), "provider:primary", []byte("secret"))
	if err != nil || result.Disposition != SavePersisted || result.Challenge != nil {
		t.Fatalf("Save = %#v, %v", result, err)
	}
	status, err := manager.Status(context.Background(), "provider:primary")
	if err != nil || status != StatusPersisted {
		t.Fatalf("Status = %q, %v", status, err)
	}
}

func TestManagerChallengesOnlyClassifiedRecoverableFailures(t *testing.T) {
	recoverable := []CredentialStatus{StatusLocked, StatusDenied, StatusUnavailable, StatusUnsupported}
	for _, status := range recoverable {
		t.Run(string(status), func(t *testing.T) {
			store := &fakeStore{putStatus: status}
			clock := &testClock{now: time.Unix(100, 0)}
			manager := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{7}, 64)), 4)
			secret, ref := "secret-value", "provider:private-ref"
			result, err := manager.Save(context.Background(), ref, []byte(secret))
			if err != nil || result.Disposition != SaveSessionConfirmationRequired || result.Challenge == nil {
				t.Fatalf("Save = %#v, %v", result, err)
			}
			if result.Challenge.Reason != status || result.Challenge.Nonce == "" || !result.Challenge.ExpiresAt.Equal(clock.Now().Add(time.Minute)) {
				t.Fatalf("unexpected challenge: %#v", result.Challenge)
			}
			raw, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				t.Fatalf("Marshal: %v", marshalErr)
			}
			if strings.Contains(string(raw), secret) || strings.Contains(string(raw), ref) {
				t.Fatalf("challenge serialized sensitive input: %s", raw)
			}
		})
	}

	store := &fakeStore{putStatus: StatusFailure}
	manager := newTestManager(t, store, &testClock{now: time.Unix(100, 0)}, bytes.NewReader(make([]byte, 64)), 4)
	result, err := manager.Save(context.Background(), "provider:primary", []byte("secret"))
	if err == nil || result.Challenge != nil {
		t.Fatalf("unclassified failure must fail closed: %#v, %v", result, err)
	}
}

func TestChallengeNonceFormatExpirySingleUseAndRestart(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusLocked}
	manager := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{9}, 128)), 4)
	result, _ := manager.Save(context.Background(), "provider:primary", []byte("not-retained"))
	nonce := result.Challenge.Nonce
	if len(nonce) != 43 {
		t.Fatalf("expected 256-bit base64url nonce, got %q", nonce)
	}
	if err := manager.ConfirmSessionCredential(context.Background(), nonce, []byte("session-secret")); err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	if err := manager.ConfirmSessionCredential(context.Background(), nonce, []byte("again")); err == nil {
		t.Fatal("nonce reuse must fail")
	}
	restarted := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{8}, 64)), 4)
	if err := restarted.ConfirmSessionCredential(context.Background(), nonce, []byte("secret")); err == nil {
		t.Fatal("nonce from prior manager must fail")
	}
	expiring, _ := manager.Save(context.Background(), "provider:other", []byte("not-retained"))
	clock.Advance(time.Minute + time.Nanosecond)
	if err := manager.ConfirmSessionCredential(context.Background(), expiring.Challenge.Nonce, []byte("secret")); err == nil {
		t.Fatal("expired nonce must fail")
	}
}

func TestChallengeDoesNotRetainSaveSecretAndBindsReference(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusDenied}
	manager := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{3}, 64)), 4)
	original := []byte("first-secret")
	result, _ := manager.Save(context.Background(), "provider:primary", original)
	pending := manager.challenges[result.Challenge.Nonce]
	if pending.ref != "provider:primary" || pending.reason != StatusDenied {
		t.Fatalf("nonce was not bound to reference and reason: %#v", pending)
	}
	for index := range original {
		original[index] = 'x'
	}
	if _, err := manager.Get(context.Background(), "provider:primary"); err == nil {
		t.Fatal("save challenge must not retain or expose the first secret")
	}
	if err := manager.ConfirmSessionCredential(context.Background(), result.Challenge.Nonce, []byte("confirmed-secret")); err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	got, err := manager.Get(context.Background(), "provider:primary")
	if err != nil || string(got) != "confirmed-secret" {
		t.Fatalf("bound Get = %q, %v", got, err)
	}
	if _, err := manager.Get(context.Background(), "provider:other"); err == nil {
		t.Fatal("nonce confirmation must not populate another reference")
	}
}

func TestChallengeCapEvictsExpiredThenOldest(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusUnavailable}
	random := bytes.NewReader(bytes.Join([][]byte{bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32), bytes.Repeat([]byte{3}, 32), bytes.Repeat([]byte{4}, 32)}, nil))
	manager := newTestManager(t, store, clock, random, 2)
	first, _ := manager.Save(context.Background(), "provider:first", []byte("one"))
	clock.Advance(time.Second)
	second, _ := manager.Save(context.Background(), "provider:second", []byte("two"))
	clock.Advance(time.Second)
	third, _ := manager.Save(context.Background(), "provider:third", []byte("three"))
	if err := manager.ConfirmSessionCredential(context.Background(), first.Challenge.Nonce, []byte("one")); err == nil {
		t.Fatal("oldest challenge should be evicted at cap")
	}
	if err := manager.ConfirmSessionCredential(context.Background(), second.Challenge.Nonce, []byte("two")); err != nil {
		t.Fatalf("second challenge should remain: %v", err)
	}
	if err := manager.ConfirmSessionCredential(context.Background(), third.Challenge.Nonce, []byte("three")); err != nil {
		t.Fatalf("third challenge should remain: %v", err)
	}
}

func TestSessionGetDefensiveCopyReplaceAndDeleteZeroMemory(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusLocked}
	manager := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{5}, 128)), 4)
	first, _ := manager.Save(context.Background(), "provider:primary", []byte("ignored"))
	input := []byte("session-one")
	if err := manager.ConfirmSessionCredential(context.Background(), first.Challenge.Nonce, input); err != nil {
		t.Fatalf("first Confirm: %v", err)
	}
	input[0] = 'X'
	got, _ := manager.Get(context.Background(), "provider:primary")
	got[0] = 'Y'
	again, _ := manager.Get(context.Background(), "provider:primary")
	if string(again) != "session-one" {
		t.Fatalf("session value was aliased: %q", again)
	}
	oldOwned := manager.session["provider:primary"]
	second, _ := manager.Save(context.Background(), "provider:primary", []byte("ignored-too"))
	if err := manager.ConfirmSessionCredential(context.Background(), second.Challenge.Nonce, []byte("session-two")); err != nil {
		t.Fatalf("second Confirm: %v", err)
	}
	if !allZero(oldOwned) {
		t.Fatalf("replaced session memory was not zeroed: %v", oldOwned)
	}
	currentOwned := manager.session["provider:primary"]
	store.delStatus = StatusDenied
	err := manager.Delete(context.Background(), "provider:primary")
	var partial *DeleteError
	if !errors.As(err, &partial) || partial.PersistentStatus() != StatusDenied || !partial.SessionDeleted() {
		t.Fatalf("expected deterministic partial delete, got %T %v", err, err)
	}
	if !allZero(currentOwned) {
		t.Fatalf("deleted session memory was not zeroed: %v", currentOwned)
	}
	if status, _ := manager.Status(context.Background(), "provider:primary"); status == StatusSessionOnly {
		t.Fatal("failed persistent delete must still remove session")
	}
}

func TestStatusPrefersSessionAndPersistentSaveClearsOldSession(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusLocked}
	manager := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{6}, 64)), 4)
	challenge, _ := manager.Save(context.Background(), "provider:primary", []byte("ignored"))
	_ = manager.ConfirmSessionCredential(context.Background(), challenge.Challenge.Nonce, []byte("old-session"))
	if status, err := manager.Status(context.Background(), "provider:primary"); err != nil || status != StatusSessionOnly {
		t.Fatalf("session Status = %q, %v", status, err)
	}
	old := manager.session["provider:primary"]
	store.putStatus = ""
	if _, err := manager.Save(context.Background(), "provider:primary", []byte("persisted-new")); err != nil {
		t.Fatalf("persistent Save: %v", err)
	}
	if !allZero(old) {
		t.Fatal("persistent replacement did not zero old session")
	}
	got, _ := manager.Get(context.Background(), "provider:primary")
	if string(got) != "persisted-new" {
		t.Fatalf("Get returned stale session value: %q", got)
	}
}

func TestManagerConcurrentOperationsAreRaceSafe(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusLocked}
	manager := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{4}, 32*500)), 32)
	var wait sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		wait.Add(1)
		go func(worker int) {
			defer wait.Done()
			ref := "provider:concurrent"
			for iteration := 0; iteration < 50; iteration++ {
				result, _ := manager.Save(context.Background(), ref, []byte("secret"))
				if result.Challenge != nil {
					_ = manager.ConfirmSessionCredential(context.Background(), result.Challenge.Nonce, []byte("confirmed"))
				}
				_, _ = manager.Get(context.Background(), ref)
				_, _ = manager.Status(context.Background(), ref)
				if worker%3 == 0 {
					_ = manager.Delete(context.Background(), ref)
				}
			}
		}(worker)
	}
	wait.Wait()
}

func TestManagerErrorsNeverIncludeRefSecretOrNonce(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusLocked}
	manager := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{2}, 64)), 4)
	ref, secret := "provider:private", "private-secret"
	result, _ := manager.Save(context.Background(), ref, []byte(secret))
	err := manager.ConfirmSessionCredential(context.Background(), result.Challenge.Nonce+"wrong", []byte(secret))
	if err == nil {
		t.Fatal("expected confirmation error")
	}
	for _, forbidden := range []string{ref, secret, result.Challenge.Nonce} {
		if strings.Contains(err.Error(), forbidden) {
			t.Fatalf("error leaked sensitive input: %q", err)
		}
	}
}

func TestTypedErrorsSanitizeUntrustedFields(t *testing.T) {
	sensitive := "provider:private private-secret raw-platform-detail nonce-value"
	errorsToCheck := []error{
		newStoreError(sensitive, CredentialStatus(sensitive)),
		newDeleteError(true, CredentialStatus(sensitive)),
	}
	for _, err := range errorsToCheck {
		if strings.Contains(err.Error(), sensitive) {
			t.Fatalf("typed error exposed untrusted field: %q", err)
		}
	}
}

func TestDeleteInvalidatesPendingChallenge(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusLocked}
	manager := newTestManager(t, store, clock, bytes.NewReader(bytes.Repeat([]byte{3}, 64)), 4)
	result, _ := manager.Save(context.Background(), "provider:primary", []byte("not-retained"))
	store.putStatus = ""
	if err := manager.Delete(context.Background(), "provider:primary"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := manager.ConfirmSessionCredential(context.Background(), result.Challenge.Nonce, []byte("secret")); err == nil {
		t.Fatal("delete must prevent a pending challenge from restoring the credential")
	}
}

func TestDefaultChallengeLifetimeIsAtMostFiveMinutes(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	manager, err := NewManager(&fakeStore{putStatus: StatusUnavailable}, ManagerOptions{
		Clock: clock.Now, Random: bytes.NewReader(bytes.Repeat([]byte{8}, 64)),
	})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	result, err := manager.Save(context.Background(), "provider:primary", []byte("secret"))
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if lifetime := result.Challenge.ExpiresAt.Sub(clock.Now()); lifetime <= 0 || lifetime > 5*time.Minute {
		t.Fatalf("unsafe default challenge lifetime: %s", lifetime)
	}
}

func allZero(value []byte) bool {
	for _, item := range value {
		if item != 0 {
			return false
		}
	}
	return true
}
