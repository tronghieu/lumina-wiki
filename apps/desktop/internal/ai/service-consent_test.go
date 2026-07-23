package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
)

func TestEmbeddingConsentFacadeStatusGrantAndRevoke(t *testing.T) {
	now := time.Date(2026, 7, 12, 2, 3, 4, 0, time.UTC)
	profile := runtimeProfile("embed-main", "embedding")
	disclosure, err := index.ConsentFingerprint(testWorkspaceID, profile)
	if err != nil {
		t.Fatal(err)
	}
	runtime := &managementRuntimeStub{consentSubject: embeddingConsentSubject{WorkspaceID: testWorkspaceID, Profile: profile, Disclosure: disclosure}, consentClearStatus: index.IndexStatus{State: index.StateEmpty}}
	service, capability, _ := newBridgeService(t, 7, runtime)
	service.now = func() time.Time { return now }
	store := service.settings.(*settingsRepositoryStub)
	store.config = runtimeConfig("chat-main", "embed-main")
	authority := service.native.(*nativeAuthorityStub)
	authority.embeddingOK = true
	request := EmbeddingConsentRequestDTO{Session: bridgeReference(capability), EmbeddingProfileID: "embed-main"}

	status, err := service.EmbeddingConsentStatus(context.Background(), request)
	if err != nil || status.Granted || status.Kind != string(index.DisclosureRemote) {
		t.Fatalf("status=%#v err=%v", status, err)
	}
	raw, _ := json.Marshal(status)
	if strings.Contains(string(raw), "endpoint") || strings.Contains(string(raw), "workspace") || strings.Contains(string(raw), "credential") {
		t.Fatalf("unsafe status=%s", raw)
	}
	if _, saves := store.counts(); saves != 0 {
		t.Fatalf("status saves=%d", saves)
	}

	granted, err := service.GrantEmbeddingConsent(context.Background(), request)
	if err != nil || !granted.Granted || granted.ProfileID != "embed-main" {
		t.Fatalf("grant=%#v err=%v", granted, err)
	}
	if err := index.RequireConsent(store.config, testWorkspaceID, profile, now); err != nil {
		t.Fatalf("saved consent=%v", err)
	}

	runtime.consentSubject.Granted = true
	before := authority.embeddingPrompt
	repeated, err := service.GrantEmbeddingConsent(context.Background(), request)
	if err != nil || !repeated.Granted || authority.embeddingPrompt != before {
		t.Fatalf("repeat=%#v err=%v", repeated, err)
	}

	revoked, err := service.RevokeEmbeddingConsent(context.Background(), request)
	if err != nil || revoked.Granted {
		t.Fatalf("revoke=%#v err=%v", revoked, err)
	}
	if index.RequireConsent(store.config, testWorkspaceID, profile, now.Add(time.Second)) == nil {
		t.Fatal("consent remains valid")
	}
	_, savesBefore := store.counts()
	if repeatedRevoke, err := service.RevokeEmbeddingConsent(context.Background(), request); err != nil || repeatedRevoke.Granted {
		t.Fatalf("repeat revoke=%#v err=%v", repeatedRevoke, err)
	}
	_, savesAfter := store.counts()
	if savesAfter != savesBefore || runtime.consentClearCalls != 2 {
		t.Fatalf("repeat saves=%d->%d clears=%d", savesBefore, savesAfter, runtime.consentClearCalls)
	}
}

func TestRevokeEmbeddingConsentClearAndSaveFailureOrdering(t *testing.T) {
	for _, test := range []struct {
		name     string
		clearErr error
		saveErr  error
	}{
		{name: "clear", clearErr: errors.New("clear failed /private")},
		{name: "save", saveErr: errors.New("save failed /private")},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, runtime, store, request := newConsentFacade(t)
			profile := runtime.consentSubject.Profile
			granted, err := index.GrantConsent(store.config, testWorkspaceID, profile, service.now(), time.Time{})
			if err != nil {
				t.Fatal(err)
			}
			store.config, store.saveErr = granted, test.saveErr
			runtime.consentSubject.Granted = true
			runtime.consentClearErr = test.clearErr
			if _, err := service.RevokeEmbeddingConsent(context.Background(), request); err == nil || strings.Contains(err.Error(), "private") {
				t.Fatalf("err=%v", err)
			}
			if index.RequireConsent(store.config, testWorkspaceID, profile, service.now()) != nil {
				t.Fatal("consent mutated on failed revoke")
			}
			_, saves := store.counts()
			if test.clearErr != nil && saves != 0 {
				t.Fatalf("clear failure saves=%d", saves)
			}
			if runtime.consentClearCalls != 1 {
				t.Fatalf("clears=%d", runtime.consentClearCalls)
			}
		})
	}
}

func TestEmbeddingConsentFacadeResolvesCapabilityBeforeProfileValidation(t *testing.T) {
	runtime := &managementRuntimeStub{}
	service, capability, _ := newBridgeService(t, 7, runtime)
	request := EmbeddingConsentRequestDTO{Session: bridgeReference(capability), EmbeddingProfileID: "\x00"}
	request.Session.Generation++
	if _, err := service.EmbeddingConsentStatus(context.Background(), request); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("err=%v", err)
	}
	if calls, _ := runtime.counts(); calls != 0 {
		t.Fatalf("runtime calls=%d", calls)
	}
	if _, err := service.GrantEmbeddingConsent(context.Background(), request); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("grant err=%v", err)
	}
	service.activations.mu.Lock()
	state := service.activations.windows[7]
	service.activations.mu.Unlock()
	if state != nil {
		t.Fatalf("forged grant acquired native gate: %#v", state)
	}
}
