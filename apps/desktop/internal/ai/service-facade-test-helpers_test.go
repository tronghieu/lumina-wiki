package ai

import (
	"context"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type settingsRepositoryStub struct {
	mu      sync.Mutex
	config  settings.Config
	loadErr error
	saveErr error
	loads   int
	saves   int
}

func (stub *settingsRepositoryStub) Load() (settings.Config, error) {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	stub.loads++
	return stub.config, stub.loadErr
}

func (stub *settingsRepositoryStub) Save(config settings.Config) error {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	stub.saves++
	if stub.saveErr == nil {
		stub.config = config
	}
	return stub.saveErr
}

func (stub *settingsRepositoryStub) counts() (int, int) {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	return stub.loads, stub.saves
}

type credentialRepositoryStub struct {
	status     secrets.CredentialStatus
	statusErr  error
	saveResult secrets.SaveResult
	saveErr    error
	confirmErr error
	deleteErr  error
	lastRef    string
	lastNonce  string
	lastSecret []byte
}

func (stub *credentialRepositoryStub) Status(context.Context, string) (secrets.CredentialStatus, error) {
	return stub.status, stub.statusErr
}

func (stub *credentialRepositoryStub) Save(_ context.Context, ref string, secret []byte) (secrets.SaveResult, error) {
	stub.lastRef, stub.lastSecret = ref, append([]byte(nil), secret...)
	return stub.saveResult, stub.saveErr
}

func (stub *credentialRepositoryStub) ConfirmSessionCredential(_ context.Context, nonce string, secret []byte) error {
	stub.lastNonce, stub.lastSecret = nonce, append([]byte(nil), secret...)
	return stub.confirmErr
}

func (stub *credentialRepositoryStub) Delete(_ context.Context, ref string) error {
	stub.lastRef = ref
	return stub.deleteErr
}

func defaultFacadeRepositories() (*settingsRepositoryStub, *credentialRepositoryStub) {
	return &settingsRepositoryStub{config: settings.DefaultConfig()}, &credentialRepositoryStub{status: secrets.StatusMissing}
}
