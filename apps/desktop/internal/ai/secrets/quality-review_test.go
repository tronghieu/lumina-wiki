package secrets

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestKeyringContextCancellationBeforeAndAfterBackendCall(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	backend := &fakeKeyring{}
	store := newKeyringStore(backend)
	if err := store.Put(ctx, "provider:primary", []byte("secret")); !errors.Is(err, context.Canceled) {
		t.Fatalf("pre-cancel Put = %v", err)
	}
	if backend.calls != 0 {
		t.Fatalf("pre-cancel reached backend %d times", backend.calls)
	}
	ctx, cancel = context.WithCancel(context.Background())
	backend = &fakeKeyring{setHook: cancel, setErr: errors.New("backend failed")}
	store = newKeyringStore(backend)
	if err := store.Put(ctx, "provider:primary", []byte("secret")); !errors.Is(err, context.Canceled) {
		t.Fatalf("post-call cancellation = %v", err)
	}
}

func TestKeyringStatusPreservesPreAndPostCallCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	backend := &fakeKeyring{}
	status, err := newKeyringStore(backend).Status(ctx, "provider:primary")
	if status != StatusFailure || !errors.Is(err, context.Canceled) {
		t.Fatalf("pre-cancel Status = %q, %v", status, err)
	}
	if backend.calls != 0 {
		t.Fatalf("pre-cancel Status made %d calls", backend.calls)
	}
	expired, expiredCancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer expiredCancel()
	status, err = newKeyringStore(backend).Status(expired, "provider:primary")
	if status != StatusFailure || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("pre-deadline Status = %q, %v", status, err)
	}

	ctx, cancel = context.WithCancel(context.Background())
	backend = &fakeKeyring{values: map[string]string{"provider:primary": "secret"}, getHook: cancel}
	status, err = newKeyringStore(backend).Status(ctx, "provider:primary")
	if status != StatusFailure || !errors.Is(err, context.Canceled) {
		t.Fatalf("post-cancel Status = %q, %v", status, err)
	}
	deadlineCtx, deadlineCancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	backend = &fakeKeyring{values: map[string]string{"provider:primary": "secret"}, getHook: func() { <-deadlineCtx.Done() }}
	status, err = newKeyringStore(backend).Status(deadlineCtx, "provider:primary")
	deadlineCancel()
	if status != StatusFailure || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("post-deadline Status = %q, %v", status, err)
	}
}

func TestSuccessfulPersistentMutationWinsCancellationAndReconcilesManager(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	backend := &fakeKeyring{values: map[string]string{"provider:primary": "old-persistent"}, setHook: cancel}
	manager, _ := NewManager(newKeyringStore(backend), ManagerOptions{})
	manager.mu.Lock()
	oldSession := []byte("old-session")
	manager.session["provider:primary"] = oldSession
	manager.known["provider:primary"] = StatusSessionOnly
	manager.mu.Unlock()
	result, err := manager.Save(ctx, "provider:primary", []byte("persistent-replacement"))
	if err != nil || result.Disposition != SavePersisted {
		t.Fatalf("committed Save = %#v, %v", result, err)
	}
	if !allZero(oldSession) {
		t.Fatal("committed Save did not clear stale session")
	}
	got, err := manager.Get(context.Background(), "provider:primary")
	if err != nil || string(got) != "persistent-replacement" {
		t.Fatalf("Get after committed Save = %q, %v", got, err)
	}

	ctx, cancel = context.WithCancel(context.Background())
	backend.deleteHook = cancel
	manager.mu.Lock()
	deleteSession := []byte("delete-session")
	manager.session["provider:primary"] = deleteSession
	manager.known["provider:primary"] = StatusSessionOnly
	manager.mu.Unlock()
	if err := manager.Delete(ctx, "provider:primary"); err != nil {
		t.Fatalf("committed Delete = %v", err)
	}
	if !allZero(deleteSession) {
		t.Fatal("committed Delete did not clear session")
	}
	if status, err := manager.Status(context.Background(), "provider:primary"); err != nil || status != StatusMissing {
		t.Fatalf("Status after committed Delete = %q, %v", status, err)
	}
}

type cancelingDeleteStore struct {
	cancel context.CancelFunc
	wait   bool
	raw    error
}

func (*cancelingDeleteStore) Put(context.Context, string, []byte) error { return nil }
func (*cancelingDeleteStore) Get(context.Context, string) ([]byte, error) {
	return nil, newStoreError("load", StatusMissing)
}
func (s *cancelingDeleteStore) Delete(ctx context.Context, _ string) error {
	if s.wait {
		<-ctx.Done()
	} else {
		s.cancel()
	}
	return s.raw
}
func (*cancelingDeleteStore) Status(context.Context, string) (CredentialStatus, error) {
	return StatusMissing, nil
}

func TestDeleteCancellationReportsSanitizedPartialOutcome(t *testing.T) {
	ref := "provider:private-reference"
	for _, test := range []struct {
		name       string
		context    func() (context.Context, context.CancelFunc)
		wait       bool
		hasSession bool
		wantCause  error
	}{
		{"canceled", func() (context.Context, context.CancelFunc) { return context.WithCancel(context.Background()) }, false, true, context.Canceled},
		{"deadline", func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(context.Background(), 5*time.Millisecond)
		}, true, false, context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := test.context()
			defer cancel()
			store := &cancelingDeleteStore{cancel: cancel, wait: test.wait, raw: errors.New("raw backend detail " + ref)}
			manager, _ := NewManager(store, ManagerOptions{})
			if test.hasSession {
				manager.mu.Lock()
				manager.session[ref] = []byte("secret")
				manager.mu.Unlock()
			}
			err := manager.Delete(ctx, ref)
			var partial *DeleteError
			if !errors.As(err, &partial) {
				t.Fatalf("expected DeleteError, got %T %v", err, err)
			}
			if partial.SessionDeleted() != test.hasSession || partial.PersistentDeleted() {
				t.Fatalf("wrong partial outcome: session=%v persistent=%v", partial.SessionDeleted(), partial.PersistentDeleted())
			}
			if !errors.Is(err, test.wantCause) {
				t.Fatalf("missing context cause: %v", err)
			}
			for _, forbidden := range []string{ref, "raw backend detail", "secret"} {
				if strings.Contains(err.Error(), forbidden) {
					t.Fatalf("DeleteError leaked detail: %q", err)
				}
			}
		})
	}
}

type cancelingStore struct {
	cancel context.CancelFunc
	owned  []byte
}

func (s *cancelingStore) Put(context.Context, string, []byte) error { s.cancel(); return nil }
func (s *cancelingStore) Get(context.Context, string) ([]byte, error) {
	s.owned = []byte("sensitive")
	s.cancel()
	return s.owned, nil
}
func (s *cancelingStore) Delete(context.Context, string) error { s.cancel(); return nil }
func (s *cancelingStore) Status(context.Context, string) (CredentialStatus, error) {
	s.cancel()
	return StatusPersisted, nil
}

func TestManagerMutationCommitAndReadCancellationAfterReturn(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	store := &cancelingStore{cancel: cancel}
	manager, _ := NewManager(store, ManagerOptions{})
	if result, err := manager.Save(ctx, "provider:primary", []byte("secret")); err != nil || result.Disposition != SavePersisted {
		t.Fatalf("committed Save = %#v, %v", result, err)
	}
	ctx, cancel = context.WithCancel(context.Background())
	store.cancel = cancel
	if _, err := manager.Get(ctx, "provider:other"); !errors.Is(err, context.Canceled) {
		t.Fatalf("Get post-call cancellation = %v", err)
	}
	if !allZero(store.owned) {
		t.Fatalf("cancelled Get bytes not zeroed: %v", store.owned)
	}
}

type blockingStore struct {
	started chan string
	release chan struct{}
}

func (s *blockingStore) Put(_ context.Context, ref string, _ []byte) error {
	if ref == "provider:blocked" {
		s.started <- ref
		<-s.release
	}
	return nil
}
func (*blockingStore) Get(context.Context, string) ([]byte, error) {
	return nil, newStoreError("load", StatusMissing)
}
func (*blockingStore) Delete(context.Context, string) error { return nil }
func (*blockingStore) Status(context.Context, string) (CredentialStatus, error) {
	return StatusMissing, nil
}

func TestManagerBackendIOOnlyBlocksSameReference(t *testing.T) {
	store := &blockingStore{started: make(chan string, 1), release: make(chan struct{})}
	manager, err := NewManager(store, ManagerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	manager.session["provider:session"] = []byte("ready")
	manager.mu.Unlock()
	done := make(chan error, 1)
	go func() {
		_, err := manager.Save(context.Background(), "provider:blocked", []byte("secret"))
		done <- err
	}()
	<-store.started
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if _, err := manager.Save(ctx, "provider:other", []byte("other")); err != nil {
		t.Fatalf("different ref blocked: %v", err)
	}
	if got, err := manager.Get(ctx, "provider:session"); err != nil || string(got) != "ready" {
		t.Fatalf("session read blocked: %q %v", got, err)
	}
	close(store.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestChallengeReplacementAndRNGFailureOrdering(t *testing.T) {
	clock := &testClock{now: time.Unix(100, 0)}
	store := &fakeStore{putStatus: StatusLocked}
	nonces := append(bytes.Repeat([]byte{1}, nonceBytes), bytes.Repeat([]byte{2}, nonceBytes)...)
	manager := newTestManager(t, store, clock, bytes.NewReader(nonces), 4)
	first, _ := manager.Save(context.Background(), "provider:primary", []byte("first"))
	second, _ := manager.Save(context.Background(), "provider:primary", []byte("second"))
	if err := manager.ConfirmSessionCredential(context.Background(), first.Challenge.Nonce, []byte("old")); err == nil {
		t.Fatal("old nonce remained valid")
	}
	manager.random = errorReader{}
	if _, err := manager.Save(context.Background(), "provider:primary", []byte("third")); err == nil {
		t.Fatal("expected RNG failure")
	}
	if err := manager.ConfirmSessionCredential(context.Background(), second.Challenge.Nonce, []byte("current")); err != nil {
		t.Fatalf("existing challenge lost: %v", err)
	}
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestManagerClampsActiveChallengeLimit(t *testing.T) {
	manager, err := NewManager(&fakeStore{}, ManagerOptions{MaxChallenges: MaxActiveChallenges * 100})
	if err != nil {
		t.Fatal(err)
	}
	if manager.maxChallenges != MaxActiveChallenges {
		t.Fatalf("cap = %d", manager.maxChallenges)
	}
}

type countingStatusStore struct {
	mu          sync.Mutex
	statusCalls int
}

func (*countingStatusStore) Put(context.Context, string, []byte) error { return nil }
func (*countingStatusStore) Get(context.Context, string) ([]byte, error) {
	return []byte("secret"), nil
}
func (*countingStatusStore) Delete(context.Context, string) error { return nil }
func (s *countingStatusStore) Status(context.Context, string) (CredentialStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statusCalls++
	return StatusPersisted, nil
}

func TestManagerStatusCachesKnownNonSecretState(t *testing.T) {
	store := &countingStatusStore{}
	manager, _ := NewManager(store, ManagerOptions{})
	for range 2 {
		status, err := manager.Status(context.Background(), "provider:primary")
		if err != nil || status != StatusPersisted {
			t.Fatalf("Status=%q %v", status, err)
		}
	}
	if store.statusCalls != 1 {
		t.Fatalf("interactive probes = %d", store.statusCalls)
	}
}

type bytesAndErrorStore struct{ owned []byte }

func (*bytesAndErrorStore) Put(context.Context, string, []byte) error { return nil }
func (s *bytesAndErrorStore) Get(context.Context, string) ([]byte, error) {
	s.owned = []byte("sensitive")
	return s.owned, errors.New("backend failed")
}
func (*bytesAndErrorStore) Delete(context.Context, string) error { return nil }
func (*bytesAndErrorStore) Status(context.Context, string) (CredentialStatus, error) {
	return StatusFailure, errors.New("failed")
}

func TestManagerZerosBackendBytesReturnedWithError(t *testing.T) {
	store := &bytesAndErrorStore{}
	manager, _ := NewManager(store, ManagerOptions{})
	_, _ = manager.Get(context.Background(), "provider:primary")
	if !allZero(store.owned) {
		t.Fatalf("backend bytes not zeroed: %v", store.owned)
	}
}

func TestSecretSizeBoundsBeforeBackend(t *testing.T) {
	backend := &fakeKeyring{}
	store := newKeyringStore(backend)
	for _, size := range []int{0, MaxSecretBytes + 1} {
		if err := store.Put(context.Background(), "provider:primary", bytes.Repeat([]byte{'x'}, size)); err == nil {
			t.Fatalf("accepted size %d", size)
		}
	}
	if backend.calls != 0 {
		t.Fatal("invalid secret reached backend")
	}
	if err := store.Put(context.Background(), "provider:primary", bytes.Repeat([]byte{'x'}, MaxSecretBytes)); err != nil {
		t.Fatalf("boundary: %v", err)
	}
}

func TestErrorsSerializeSafelyAndDeleteTracksPresence(t *testing.T) {
	sensitive := "private-ref private-secret raw-status nonce"
	err := newStoreError(sensitive, CredentialStatus(sensitive))
	raw, _ := json.Marshal(err)
	if strings.Contains(string(raw), sensitive) {
		t.Fatalf("StoreError JSON leaked: %s", raw)
	}
	manager, _ := NewManager(&fakeStore{delStatus: StatusDenied}, ManagerOptions{})
	deleteErr := manager.Delete(context.Background(), "provider:absent")
	var partial *DeleteError
	if !errors.As(deleteErr, &partial) || partial.SessionDeleted() {
		t.Fatalf("absence reported deleted: %#v", partial)
	}
}

func TestUnixPathErrorClassificationInspectsErrno(t *testing.T) {
	tests := []struct {
		errno syscall.Errno
		want  CredentialStatus
	}{{syscall.EACCES, StatusDenied}, {syscall.EPERM, StatusDenied}, {syscall.ENOENT, StatusUnavailable}, {syscall.ECONNREFUSED, StatusUnavailable}, {syscall.EINVAL, StatusFailure}}
	for _, test := range tests {
		err := &os.PathError{Op: "dial", Path: "/private", Err: test.errno}
		if got := classifyPlatformKeyringError(err, "linux"); got != test.want {
			t.Fatalf("errno %v = %q want %q", test.errno, got, test.want)
		}
	}
}
