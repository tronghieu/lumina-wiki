package ai

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type blockingConsentSaveRepository struct {
	mu        sync.Mutex
	config    settings.Config
	calls     int
	entered   chan struct{}
	release   chan struct{}
	failCall  int
	blockCall int
}

func TestGrantEmbeddingConsentHidesTransientSaveAndReleasesAcceptedGrant(t *testing.T) {
	service, _, store, request := newConsentFacade(t)
	service.native.(*nativeAuthorityStub).embeddingOK = true
	repository := &blockingConsentSaveRepository{config: store.config, entered: make(chan struct{}), release: make(chan struct{})}
	service.settings = repository
	grantDone := make(chan error, 1)
	go func() { _, err := service.GrantEmbeddingConsent(context.Background(), request); grantDone <- err }()
	<-repository.entered

	waitCtx, cancel := context.WithCancel(context.Background())
	useDone := make(chan error, 1)
	go func() {
		finish, err := service.consentAccess.BeginUse(waitCtx)
		if err == nil {
			finish()
		}
		useDone <- err
	}()
	select {
	case err := <-useDone:
		t.Fatalf("consumer observed transient grant: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	cancel()
	if err := <-useDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled consumer error = %v", err)
	}

	close(repository.release)
	if err := <-grantDone; err != nil {
		t.Fatalf("grant failed: %v", err)
	}
	finish, err := service.consentAccess.BeginUse(context.Background())
	if err != nil {
		t.Fatalf("accepted grant did not release gate: %v", err)
	}
	finish()
}

func (repository *blockingConsentSaveRepository) Load() (settings.Config, error) {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	return repository.config, nil
}

func (repository *blockingConsentSaveRepository) Save(config settings.Config) error {
	repository.mu.Lock()
	repository.calls++
	call := repository.calls
	if call != repository.failCall {
		repository.config = config
	}
	repository.mu.Unlock()
	blockCall := repository.blockCall
	if blockCall == 0 {
		blockCall = 1
	}
	if call == blockCall {
		close(repository.entered)
		<-repository.release
	}
	if call == repository.failCall {
		return errors.New("save failed /private")
	}
	return nil
}

func TestGrantEmbeddingConsentSuccessfulPromotionWinsCallerCancellation(t *testing.T) {
	service, _, store, request := newConsentFacade(t)
	service.native.(*nativeAuthorityStub).embeddingOK = true
	repository := &blockingConsentSaveRepository{
		config: store.config, entered: make(chan struct{}), release: make(chan struct{}), blockCall: 2,
	}
	service.settings = repository
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := service.GrantEmbeddingConsent(ctx, request)
		done <- err
	}()
	<-repository.entered
	cancel()
	close(repository.release)
	if err := <-done; err != nil {
		t.Fatalf("committed grant returned error: %v", err)
	}
	if err := index.RequireConsent(repository.config, testWorkspaceID, runtimeProfile("embed-main", "embedding"), service.now()); err != nil {
		t.Fatalf("successful promotion did not authorize embedding: %v", err)
	}
}

func TestGrantEmbeddingConsentPromotionFinishesBeforeWindowRetirement(t *testing.T) {
	service, _, store, request := newConsentFacade(t)
	service.native.(*nativeAuthorityStub).embeddingOK = true
	repository := &blockingConsentSaveRepository{
		config: store.config, entered: make(chan struct{}), release: make(chan struct{}), blockCall: 2,
	}
	service.settings = repository
	grantDone := make(chan error, 1)
	go func() {
		_, err := service.GrantEmbeddingConsent(context.Background(), request)
		grantDone <- err
	}()
	<-repository.entered
	closeDone := make(chan error, 1)
	go func() { closeDone <- CloseWindow(service, 7) }()
	select {
	case err := <-closeDone:
		t.Fatalf("window retired during consent promotion: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(repository.release)
	if err := <-grantDone; err != nil {
		t.Fatalf("committed grant returned error: %v", err)
	}
	if err := <-closeDone; err != nil {
		t.Fatalf("window close: %v", err)
	}
	if err := index.RequireConsent(repository.config, testWorkspaceID, runtimeProfile("embed-main", "embedding"), service.now()); err != nil {
		t.Fatalf("successful promotion did not authorize embedding: %v", err)
	}
}

func TestGrantEmbeddingConsentRollsBackSaveWhenCommitCannotDeliver(t *testing.T) {
	for _, test := range []struct {
		name     string
		action   func(*Service, context.CancelFunc)
		expected error
	}{
		{name: "window", action: func(service *Service, _ context.CancelFunc) { _ = CloseWindow(service, 7) }, expected: ErrWindowUnavailable},
		{name: "global", action: func(service *Service, _ context.CancelFunc) { _ = Close(service) }, expected: ErrWindowUnavailable},
		{name: "caller", action: func(_ *Service, cancel context.CancelFunc) { cancel() }, expected: context.Canceled},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, _, store, request := newConsentFacade(t)
			service.native.(*nativeAuthorityStub).embeddingOK = true
			repository := &blockingConsentSaveRepository{config: store.config, entered: make(chan struct{}), release: make(chan struct{})}
			service.settings = repository
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { _, err := service.GrantEmbeddingConsent(ctx, request); done <- err }()
			<-repository.entered
			test.action(service, cancel)
			close(repository.release)
			if err := <-done; !errors.Is(err, test.expected) {
				t.Fatalf("err=%v", err)
			}
			if repository.calls != 2 {
				t.Fatalf("save calls=%d", repository.calls)
			}
			if index.RequireConsent(repository.config, testWorkspaceID, runtimeProfile("embed-main", "embedding"), service.now()) == nil {
				t.Fatal("late grant was not rolled back")
			}
		})
	}
}

func TestGrantEmbeddingConsentReportsCompensationFailure(t *testing.T) {
	service, _, store, request := newConsentFacade(t)
	service.native.(*nativeAuthorityStub).embeddingOK = true
	repository := &blockingConsentSaveRepository{config: store.config, entered: make(chan struct{}), release: make(chan struct{}), failCall: 2}
	service.settings = repository
	done := make(chan error, 1)
	go func() { _, err := service.GrantEmbeddingConsent(context.Background(), request); done <- err }()
	<-repository.entered
	close(repository.release)
	if err := <-done; !errors.Is(err, ErrSettingsUnavailable) {
		t.Fatalf("err=%v", err)
	}
	if repository.calls != 2 {
		t.Fatalf("save calls=%d", repository.calls)
	}
	if err := index.RequireConsent(repository.config, testWorkspaceID, runtimeProfile("embed-main", "embedding"), service.now()); !errors.Is(err, index.ErrConsentRequired) {
		t.Fatalf("failed promotion authorized embedding: %v", err)
	}
}

func TestRevokeEmbeddingConsentRollsBackSaveAfterSessionRetires(t *testing.T) {
	service, runtime, store, request := newConsentFacade(t)
	profile := runtime.consentSubject.Profile
	granted, err := index.GrantConsent(store.config, testWorkspaceID, profile, service.now(), time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	runtime.consentSubject.Granted = true
	repository := &blockingConsentSaveRepository{
		config:  granted,
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	service.settings = repository
	done := make(chan error, 1)
	go func() {
		_, revokeErr := service.RevokeEmbeddingConsent(context.Background(), request)
		done <- revokeErr
	}()
	<-repository.entered
	if err := service.DeactivateWorkspace(context.Background(), request.Session); err != nil {
		t.Fatal(err)
	}
	close(repository.release)
	if err := <-done; !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("late revoke err=%v", err)
	}
	if repository.calls != 2 {
		t.Fatalf("save calls=%d", repository.calls)
	}
	if err := index.RequireConsent(repository.config, testWorkspaceID, profile, service.now()); err != nil {
		t.Fatalf("late revoke was not rolled back: %v", err)
	}
}
