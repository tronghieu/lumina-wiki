package ai

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
)

func TestProfileCredentialReferenceUsesCredentialFacadeGrammar(t *testing.T) {
	invalid := []string{
		strings.Repeat("a", 129),
		"folder/key",
		"key with space",
		"key\ncontrol",
		"khóa:chính",
	}
	for _, reference := range invalid {
		t.Run(reference, func(t *testing.T) {
			service, _, _, _, _, _ := newTestService(&callLog{})
			store := service.settings.(*settingsRepositoryStub)
			request := validProfileRequest("chat")
			request.CredentialRef = reference
			if _, err := service.SaveAIProfile(context.Background(), request); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("err=%v", err)
			}
			if loads, saves := store.counts(); loads != 0 || saves != 0 {
				t.Fatalf("repository calls load=%d save=%d", loads, saves)
			}
		})
	}
}

func TestValidSharedCredentialReferenceRoundTripsAcrossFacades(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	reference := "shared:key.name-1_under"
	request := validProfileRequest("chat")
	request.CredentialRef = reference
	profile, err := service.SaveAIProfile(context.Background(), request)
	if err != nil || profile.CredentialRef != reference {
		t.Fatalf("profile=%+v err=%v", profile, err)
	}
	status, err := service.CredentialStatus(context.Background(), CredentialReferenceDTO{CredentialRef: reference})
	if err != nil || status.Status != "missing" {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	repository := service.credentials.(*credentialRepositoryStub)
	repository.saveResult = secrets.SaveResult{Disposition: secrets.SavePersisted}
	secret := []byte("private")
	if _, err := service.SaveCredential(context.Background(), SaveCredentialRequestDTO{CredentialRef: reference, Secret: secret}); err != nil {
		t.Fatalf("save credential err=%v", err)
	}
	if _, err := service.DeleteCredential(context.Background(), CredentialReferenceDTO{CredentialRef: reference}); err != nil {
		t.Fatalf("delete credential err=%v", err)
	}
	request = validProfileRequest("embedding")
	request.CredentialRef = ""
	if profile, err := service.SaveAIProfile(context.Background(), request); err != nil || profile.CredentialRef != "" {
		t.Fatalf("empty profile reference=%+v err=%v", profile, err)
	}
	if _, err := service.CredentialStatus(context.Background(), CredentialReferenceDTO{}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty credential operation err=%v", err)
	}
}
