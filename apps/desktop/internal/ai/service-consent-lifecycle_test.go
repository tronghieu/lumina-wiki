package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type blockingConsentAuthority struct {
	*nativeAuthorityStub
	entered chan session.WindowID
	release chan struct{}
	answer  bool
	err     error
}

type parallelConsentAuthority struct {
	*nativeAuthorityStub
	entered chan session.WindowID
	release chan struct{}
}

func (authority *parallelConsentAuthority) ConfirmEmbeddingDisclosure(_ context.Context, window session.WindowID, _ EmbeddingDisclosure) (bool, error) {
	authority.entered <- window
	<-authority.release
	return true, nil
}

func (authority *blockingConsentAuthority) ConfirmEmbeddingDisclosure(_ context.Context, window session.WindowID, disclosure EmbeddingDisclosure) (bool, error) {
	authority.embeddingPrompt = disclosure
	authority.entered <- window
	<-authority.release
	return authority.answer, authority.err
}

func newConsentFacade(t *testing.T) (*Service, *managementRuntimeStub, *settingsRepositoryStub, EmbeddingConsentRequestDTO) {
	t.Helper()
	profile := runtimeProfile("embed-main", "embedding")
	disclosure, err := index.ConsentFingerprint(testWorkspaceID, profile)
	if err != nil {
		t.Fatal(err)
	}
	runtime := &managementRuntimeStub{consentSubject: embeddingConsentSubject{WorkspaceID: testWorkspaceID, Profile: profile, Disclosure: disclosure}, consentClearStatus: index.IndexStatus{State: index.StateEmpty}}
	service, capability, _ := newBridgeService(t, 7, runtime)
	service.now = func() time.Time { return time.Date(2026, 7, 12, 3, 4, 5, 0, time.UTC) }
	store := service.settings.(*settingsRepositoryStub)
	store.config = runtimeConfig("chat-main", "embed-main")
	return service, runtime, store, EmbeddingConsentRequestDTO{Session: bridgeReference(capability), EmbeddingProfileID: "embed-main"}
}

func TestDeactivateWorkspaceRejectsStaleReferenceWithoutCancellingWindowWork(t *testing.T) {
	service, _, _, request := newConsentFacade(t)
	active, err := service.activations.Acquire(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	defer active.Finish()
	stale := request.Session
	stale.Generation++
	if err := service.DeactivateWorkspace(gateContext(7), stale); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("deactivate err=%v", err)
	}
	if err := active.Validate(); err != nil {
		t.Fatalf("stale reference cancelled legitimate work: %v", err)
	}
}

func TestGrantEmbeddingConsentWindowCloseAndConcurrentPromptDoNotSave(t *testing.T) {
	service, _, store, request := newConsentFacade(t)
	base := service.native.(*nativeAuthorityStub)
	authority := &blockingConsentAuthority{nativeAuthorityStub: base, entered: make(chan session.WindowID, 1), release: make(chan struct{}), answer: true}
	service.native = authority
	done := make(chan error, 1)
	go func() { _, err := service.GrantEmbeddingConsent(context.Background(), request); done <- err }()
	if window := <-authority.entered; window != 7 {
		t.Fatalf("owner=%d", window)
	}
	if _, err := service.GrantEmbeddingConsent(context.Background(), request); !errors.Is(err, ErrActivationBusy) {
		t.Fatalf("concurrent err=%v", err)
	}
	if err := CloseWindow(service, 7); err != nil {
		t.Fatal(err)
	}
	close(authority.release)
	if err := <-done; !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("late grant err=%v", err)
	}
	if _, saves := store.counts(); saves != 0 {
		t.Fatalf("saves=%d", saves)
	}
}

func TestGrantEmbeddingConsentPreservesCallerCancellationDuringPrompt(t *testing.T) {
	service, _, store, request := newConsentFacade(t)
	authority := &blockingConsentAuthority{
		nativeAuthorityStub: service.native.(*nativeAuthorityStub),
		entered:             make(chan session.WindowID, 1),
		release:             make(chan struct{}),
		answer:              true,
	}
	service.native = authority
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := service.GrantEmbeddingConsent(ctx, request)
		done <- err
	}()
	<-authority.entered
	cancel()
	close(authority.release)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("prompt cancellation err=%v", err)
	}
	if _, saves := store.counts(); saves != 0 {
		t.Fatalf("saves=%d", saves)
	}
}

func TestRevokeEmbeddingConsentCancelsBuildBeforeWaitingForAccessGate(t *testing.T) {
	service, runtime, store, request := newConsentFacade(t)
	profile := runtime.consentSubject.Profile
	granted, err := index.GrantConsent(store.config, testWorkspaceID, profile, service.now(), time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	store.config = granted
	runtime.consentSubject.Granted = true
	runtime.consentMutation = make(chan struct{})
	finishBuildUse, err := service.consentAccess.BeginUse(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, revokeErr := service.RevokeEmbeddingConsent(context.Background(), request)
		done <- revokeErr
	}()
	select {
	case <-runtime.consentMutation:
	case <-time.After(200 * time.Millisecond):
		finishBuildUse()
		<-done
		t.Fatal("revoke waited for the access gate before cancelling the active build")
	}
	finishBuildUse()
	if err := <-done; err != nil {
		t.Fatalf("revoke err=%v", err)
	}
}

func TestGrantEmbeddingConsentDeactivateOrProfileChangeDoesNotSave(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*Service, *settingsRepositoryStub, EmbeddingConsentRequestDTO)
	}{
		{name: "deactivate", mutate: func(service *Service, _ *settingsRepositoryStub, request EmbeddingConsentRequestDTO) {
			_ = service.DeactivateWorkspace(context.Background(), request.Session)
		}},
		{name: "profile", mutate: func(_ *Service, store *settingsRepositoryStub, _ EmbeddingConsentRequestDTO) {
			store.mu.Lock()
			store.config = runtimeConfig("chat-main", "embed-next")
			store.mu.Unlock()
		}},
		{name: "label", mutate: func(_ *Service, store *settingsRepositoryStub, _ EmbeddingConsentRequestDTO) {
			store.mu.Lock()
			changed := *store.config.Embedding
			changed.Label = "Changed label"
			store.config.Embedding = &changed
			store.mu.Unlock()
		}},
		{name: "credential", mutate: func(_ *Service, store *settingsRepositoryStub, _ EmbeddingConsentRequestDTO) {
			store.mu.Lock()
			changed := *store.config.Embedding
			changed.CredentialRef = "changed-ref"
			store.config.Embedding = &changed
			store.mu.Unlock()
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, _, store, request := newConsentFacade(t)
			authority := &blockingConsentAuthority{nativeAuthorityStub: service.native.(*nativeAuthorityStub), entered: make(chan session.WindowID, 1), release: make(chan struct{}), answer: true}
			service.native = authority
			done := make(chan error, 1)
			go func() { _, err := service.GrantEmbeddingConsent(context.Background(), request); done <- err }()
			<-authority.entered
			test.mutate(service, store, request)
			close(authority.release)
			if err := <-done; err == nil {
				t.Fatal("stale grant succeeded")
			}
			if _, saves := store.counts(); saves != 0 {
				t.Fatalf("saves=%d", saves)
			}
		})
	}
}

func TestGrantEmbeddingConsentDenialAndNativeErrorDoNotSave(t *testing.T) {
	for _, nativeErr := range []error{nil, errors.New("native /private secret")} {
		service, _, store, request := newConsentFacade(t)
		authority := service.native.(*nativeAuthorityStub)
		authority.embeddingOK, authority.embeddingErr = false, nativeErr
		result, err := service.GrantEmbeddingConsent(context.Background(), request)
		if nativeErr == nil && (err != nil || result.Granted) {
			t.Fatalf("denial=%#v err=%v", result, err)
		}
		if nativeErr != nil && (!errors.Is(err, ErrNativeAuthority) || err.Error() == nativeErr.Error()) {
			t.Fatalf("native err=%v", err)
		}
		if _, saves := store.counts(); saves != 0 {
			t.Fatalf("saves=%d", saves)
		}
	}
}

func TestGrantEmbeddingConsentDialogsAreIsolatedAcrossWindows(t *testing.T) {
	profile := runtimeProfile("embed-main", "embedding")
	disclosure, _ := index.ConsentFingerprint(testWorkspaceID, profile)
	subject := embeddingConsentSubject{WorkspaceID: testWorkspaceID, Profile: profile, Disclosure: disclosure}
	registry := session.NewRegistry(session.Options{})
	first, err := registry.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "First"}, &managementRuntimeStub{consentSubject: subject})
	if err != nil {
		t.Fatal(err)
	}
	second, err := registry.Activate(8, testWorkspaceID, session.DisplayMetadata{Label: "Second"}, &managementRuntimeStub{consentSubject: subject})
	if err != nil {
		t.Fatal(err)
	}
	log := &callLog{}
	authority := &parallelConsentAuthority{nativeAuthorityStub: &nativeAuthorityStub{log: log}, entered: make(chan session.WindowID, 2), release: make(chan struct{})}
	store := &settingsRepositoryStub{config: runtimeConfig("chat-main", "embed-main")}
	service, err := NewService(Dependencies{ConsentAccess: NewConsentAccessGate(), Windows: gateWindowResolver{}, Native: authority, Validator: &validatorStub{log: log},
		Attacher: &attacherStub{log: log}, Runtimes: &runtimeFactoryStub{log: log}, Sessions: registry,
		Streams: streamSinkFactoryStub{}, Settings: store, Credentials: &credentialRepositoryStub{}})
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time { return time.Date(2026, 7, 12, 3, 4, 5, 0, time.UTC) }
	done := make(chan error, 2)
	for _, call := range []struct {
		window     session.WindowID
		capability session.Capability
	}{{7, first}, {8, second}} {
		go func() {
			_, callErr := service.GrantEmbeddingConsent(gateContext(call.window), EmbeddingConsentRequestDTO{Session: bridgeReference(call.capability), EmbeddingProfileID: "embed-main"})
			done <- callErr
		}()
	}
	owners := map[session.WindowID]bool{<-authority.entered: true, <-authority.entered: true}
	if !owners[7] || !owners[8] {
		t.Fatalf("owners=%v", owners)
	}
	close(authority.release)
	if err, err2 := <-done, <-done; err != nil || err2 != nil {
		t.Fatalf("errors=%v %v", err, err2)
	}
}
