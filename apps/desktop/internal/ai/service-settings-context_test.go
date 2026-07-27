package ai

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type controlledSettingsContext struct {
	context.Context
	mu      sync.Mutex
	err     error
	checked chan struct{}
	once    sync.Once
}

func newControlledSettingsContext() *controlledSettingsContext {
	return &controlledSettingsContext{Context: context.Background(), checked: make(chan struct{})}
}

func (ctx *controlledSettingsContext) Err() error {
	ctx.mu.Lock()
	defer ctx.mu.Unlock()
	ctx.once.Do(func() { close(ctx.checked) })
	return ctx.err
}

func (ctx *controlledSettingsContext) fail(err error) {
	ctx.mu.Lock()
	ctx.err = err
	ctx.mu.Unlock()
}

type failOnContextCheck struct {
	context.Context
	mu     sync.Mutex
	calls  int
	failAt int
	err    error
}

func (ctx *failOnContextCheck) Err() error {
	ctx.mu.Lock()
	defer ctx.mu.Unlock()
	ctx.calls++
	if ctx.calls >= ctx.failAt {
		return ctx.err
	}
	return nil
}

func TestSettingsCancellationWhileQueuedDoesNotLoad(t *testing.T) {
	operations := map[string]func(*Service, context.Context) error{
		"list": func(service *Service, ctx context.Context) error {
			_, err := service.ListAIProfiles(ctx)
			return err
		},
		"save": func(service *Service, ctx context.Context) error {
			_, err := service.SaveAIProfile(ctx, validProfileRequest("chat"))
			return err
		},
		"delete": func(service *Service, ctx context.Context) error {
			_, err := service.DeleteAIProfile(ctx, DeleteAIProfileRequestDTO{Role: "chat", ID: "chat-main"})
			return err
		},
	}
	for _, contextErr := range []error{context.Canceled, context.DeadlineExceeded} {
		for name, operation := range operations {
			t.Run(name+"/"+contextErr.Error(), func(t *testing.T) {
				service, _, _, _, _, _ := newTestService(&callLog{})
				store := service.settings.(*settingsRepositoryStub)
				ctx := newControlledSettingsContext()
				service.settingsMu.Lock()
				done := make(chan error, 1)
				go func() { done <- operation(service, ctx) }()
				<-ctx.checked
				ctx.fail(contextErr)
				service.settingsMu.Unlock()
				if err := <-done; !errors.Is(err, contextErr) {
					t.Fatalf("err=%v", err)
				}
				if loads, saves := store.counts(); loads != 0 || saves != 0 {
					t.Fatalf("calls load=%d save=%d", loads, saves)
				}
			})
		}
	}
}

func TestSettingsCancellationDuringLoadDoesNotSave(t *testing.T) {
	chat := validProfileRequest("chat").profile()
	operations := map[string]func(*Service, context.Context) error{
		"list": func(service *Service, ctx context.Context) error {
			_, err := service.ListAIProfiles(ctx)
			return err
		},
		"save": func(service *Service, ctx context.Context) error {
			_, err := service.SaveAIProfile(ctx, validProfileRequest("embedding"))
			return err
		},
		"delete": func(service *Service, ctx context.Context) error {
			_, err := service.DeleteAIProfile(ctx, DeleteAIProfileRequestDTO{Role: "chat", ID: "chat-main"})
			return err
		},
	}
	for name, operation := range operations {
		t.Run(name, func(t *testing.T) {
			base := &settingsRepositoryStub{config: settings.Config{SchemaVersion: settings.CurrentSchemaVersion, Chat: &chat}}
			store := &blockingSettingsRepository{settingsRepositoryStub: base, loadStarted: make(chan struct{}), releaseLoad: make(chan struct{})}
			service, _, _, _, _, _ := newTestService(&callLog{})
			service.settings = store
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { done <- operation(service, ctx) }()
			<-store.loadStarted
			cancel()
			close(store.releaseLoad)
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Fatalf("err=%v", err)
			}
			if _, saves := base.counts(); saves != 0 {
				t.Fatalf("save calls=%d", saves)
			}
			config, _ := base.Load()
			if config.Chat == nil || config.Chat.ID != "chat-main" || config.Embedding != nil {
				t.Fatalf("mutated config=%+v", config)
			}
		})
	}
}

func TestSettingsCancellationImmediatelyBeforeSaveDoesNotMutate(t *testing.T) {
	chat := validProfileRequest("chat").profile()
	operations := map[string]func(*Service, context.Context) error{
		"save": func(service *Service, ctx context.Context) error {
			_, err := service.SaveAIProfile(ctx, validProfileRequest("embedding"))
			return err
		},
		"delete": func(service *Service, ctx context.Context) error {
			_, err := service.DeleteAIProfile(ctx, DeleteAIProfileRequestDTO{Role: "chat", ID: "chat-main"})
			return err
		},
	}
	for _, contextErr := range []error{context.Canceled, context.DeadlineExceeded} {
		for name, operation := range operations {
			t.Run(name+"/"+contextErr.Error(), func(t *testing.T) {
				store := &settingsRepositoryStub{config: settings.Config{SchemaVersion: settings.CurrentSchemaVersion, Chat: &chat}}
				service, _, _, _, _, _ := newTestService(&callLog{})
				service.settings = store
				ctx := &failOnContextCheck{Context: context.Background(), failAt: 4, err: contextErr}
				if err := operation(service, ctx); !errors.Is(err, contextErr) {
					t.Fatalf("err=%v", err)
				}
				if loads, saves := store.counts(); loads != 1 || saves != 0 {
					t.Fatalf("calls load=%d save=%d", loads, saves)
				}
				config, _ := store.Load()
				if config.Chat == nil || config.Chat.ID != "chat-main" || config.Embedding != nil {
					t.Fatalf("mutated config=%+v", config)
				}
			})
		}
	}
}
