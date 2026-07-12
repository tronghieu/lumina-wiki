package ai

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
)

func TestCredentialStatusReturnsEveryKnownSafeStatus(t *testing.T) {
	for _, status := range []secrets.CredentialStatus{secrets.StatusMissing, secrets.StatusPersisted, secrets.StatusSessionOnly,
		secrets.StatusLocked, secrets.StatusDenied, secrets.StatusUnavailable, secrets.StatusUnsupported, secrets.StatusFailure} {
		t.Run(string(status), func(t *testing.T) {
			service, _, _, _, _, _ := newTestService(&callLog{})
			service.credentials.(*credentialRepositoryStub).status = status
			got, err := service.CredentialStatus(context.Background(), CredentialReferenceDTO{CredentialRef: "key:main"})
			if err != nil || got.Status != string(status) {
				t.Fatalf("status=%+v err=%v", got, err)
			}
		})
	}
}

func TestSaveCredentialZeroesInputAndReturnsPersisted(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	repository := service.credentials.(*credentialRepositoryStub)
	repository.saveResult = secrets.SaveResult{Disposition: secrets.SavePersisted}
	secret := []byte("top-secret-value")
	got, err := service.SaveCredential(context.Background(), SaveCredentialRequestDTO{CredentialRef: "key:main", Secret: secret})
	if err != nil || got.Disposition != "persisted" || got.Challenge != nil {
		t.Fatalf("got=%+v err=%v", got, err)
	}
	if string(repository.lastSecret) != "top-secret-value" {
		t.Fatalf("backend secret=%q", repository.lastSecret)
	}
	for _, value := range secret {
		if value != 0 {
			t.Fatalf("input not zeroed: %v", secret)
		}
	}
}

func TestSaveCredentialReturnsOpaqueSessionChallenge(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	repository := service.credentials.(*credentialRepositoryStub)
	expires := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)
	repository.saveResult = secrets.SaveResult{Disposition: secrets.SaveSessionConfirmationRequired,
		Challenge: &secrets.SessionChallenge{Nonce: "opaque-nonce", Reason: secrets.StatusLocked, ExpiresAt: expires}}
	secret := []byte("private")
	got, err := service.SaveCredential(context.Background(), SaveCredentialRequestDTO{CredentialRef: "key:main", Secret: secret})
	if err != nil || got.Challenge == nil || got.Challenge.Nonce != "opaque-nonce" || got.Challenge.Reason != "locked" {
		t.Fatalf("got=%+v err=%v", got, err)
	}
	raw, _ := json.Marshal(got)
	want := `{"disposition":"session_confirmation_required","challenge":{"nonce":"opaque-nonce","reason":"locked","expiresAt":"2026-07-12T01:02:03Z"}}`
	if string(raw) != want {
		t.Fatalf("json=%s", raw)
	}
	if strings.Contains(string(raw), "private") || containsJSONField(raw, "secret") || containsJSONField(raw, "credentialRef") {
		t.Fatalf("unsafe response=%s", raw)
	}
}

func TestConfirmSessionCredentialUsesNonceAndZeroesInput(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	repository := service.credentials.(*credentialRepositoryStub)
	secret := []byte("session-secret")
	got, err := service.ConfirmSessionCredential(context.Background(), ConfirmSessionCredentialRequestDTO{Nonce: "opaque-nonce", Secret: secret})
	if err != nil || got.Status != "session_only" || repository.lastNonce != "opaque-nonce" {
		t.Fatalf("got=%+v err=%v", got, err)
	}
	for _, value := range secret {
		if value != 0 {
			t.Fatal("input not zeroed")
		}
	}
}

func TestCredentialFacadeRejectsInvalidAndSanitizesBackendErrors(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	repository := service.credentials.(*credentialRepositoryStub)
	secret := []byte("hidden")
	if _, err := service.SaveCredential(context.Background(), SaveCredentialRequestDTO{CredentialRef: "bad ref", Secret: secret}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid err=%v", err)
	}
	for _, value := range secret {
		if value != 0 {
			t.Fatal("invalid input not zeroed")
		}
	}
	repository.saveErr = errors.New("private keyring path /Users/person")
	secret = []byte("hidden-again")
	_, err := service.SaveCredential(context.Background(), SaveCredentialRequestDTO{CredentialRef: "key:main", Secret: secret})
	if !errors.Is(err, ErrCredentialUnavailable) || strings.Contains(err.Error(), "Users") || strings.Contains(err.Error(), "hidden") {
		t.Fatalf("err=%v", err)
	}
}

func TestDeleteCredentialReturnsMissingOrStableError(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	repository := service.credentials.(*credentialRepositoryStub)
	got, err := service.DeleteCredential(context.Background(), CredentialReferenceDTO{CredentialRef: "key:main"})
	if err != nil || !got.Deleted || got.Status != "missing" {
		t.Fatalf("got=%+v err=%v", got, err)
	}
	repository.deleteErr = errors.New("backend detail")
	if _, err := service.DeleteCredential(context.Background(), CredentialReferenceDTO{CredentialRef: "key:main"}); !errors.Is(err, ErrCredentialUnavailable) {
		t.Fatalf("err=%v", err)
	}
}

func TestCredentialFacadePreservesCancellation(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	secret := []byte("hidden")
	if _, err := service.SaveCredential(ctx, SaveCredentialRequestDTO{CredentialRef: "key:main", Secret: secret}); !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
	for _, value := range secret {
		if value != 0 {
			t.Fatal("canceled input not zeroed")
		}
	}
}

func TestCredentialFacadeRejectsOversizeAndHasNoGetContract(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	secret := make([]byte, secrets.MaxSecretBytes+1)
	for index := range secret {
		secret[index] = 'x'
	}
	if _, err := service.SaveCredential(context.Background(), SaveCredentialRequestDTO{CredentialRef: "key:main", Secret: secret}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("err=%v", err)
	}
	for _, value := range secret {
		if value != 0 {
			t.Fatal("oversize input not zeroed")
		}
	}
	if _, exists := reflect.TypeOf((*CredentialRepository)(nil)).Elem().MethodByName("Get"); exists {
		t.Fatal("credential facade must never expose Get")
	}
}

func TestCredentialFacadePreservesBackendDeadlineAndSanitizesReplay(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	repository := service.credentials.(*credentialRepositoryStub)
	repository.confirmErr = errors.New("expired nonce detail")
	secret := []byte("private")
	_, err := service.ConfirmSessionCredential(context.Background(), ConfirmSessionCredentialRequestDTO{Nonce: "opaque-nonce", Secret: secret})
	if !errors.Is(err, ErrCredentialUnavailable) || strings.Contains(err.Error(), "nonce") {
		t.Fatalf("err=%v", err)
	}
	repository.confirmErr = context.DeadlineExceeded
	secret = []byte("private")
	if _, err := service.ConfirmSessionCredential(context.Background(), ConfirmSessionCredentialRequestDTO{Nonce: "opaque-nonce", Secret: secret}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline err=%v", err)
	}
}
