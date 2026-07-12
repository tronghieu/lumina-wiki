package ai

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type blockingSettingsRepository struct {
	*settingsRepositoryStub
	first       sync.Once
	loadStarted chan struct{}
	releaseLoad chan struct{}
}

func (repository *blockingSettingsRepository) Load() (settings.Config, error) {
	repository.first.Do(func() {
		close(repository.loadStarted)
		<-repository.releaseLoad
	})
	return repository.settingsRepositoryStub.Load()
}

func TestConcurrentSaveDeleteUsesOneReadModifyWriteSequence(t *testing.T) {
	service, _, _, _, _, _ := newTestService(&callLog{})
	repository := &blockingSettingsRepository{settingsRepositoryStub: &settingsRepositoryStub{config: settings.DefaultConfig()},
		loadStarted: make(chan struct{}), releaseLoad: make(chan struct{})}
	service.settings = repository
	saveDone := make(chan error, 1)
	go func() {
		_, err := service.SaveAIProfile(context.Background(), validProfileRequest("chat"))
		saveDone <- err
	}()
	<-repository.loadStarted
	deleteDone := make(chan error, 1)
	go func() {
		_, err := service.DeleteAIProfile(context.Background(), DeleteAIProfileRequestDTO{Role: "chat", ID: "chat-main"})
		deleteDone <- err
	}()
	select {
	case err := <-deleteDone:
		t.Fatalf("delete entered repository before save completed: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(repository.releaseLoad)
	if err := <-saveDone; err != nil {
		t.Fatal(err)
	}
	if err := <-deleteDone; err != nil {
		t.Fatal(err)
	}
	config, err := repository.settingsRepositoryStub.Load()
	if err != nil || config.Chat != nil {
		t.Fatalf("config=%+v err=%v", config, err)
	}
}
