package ai

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type contextBlockingSinkFactory struct {
	entered, cancelled chan struct{}
	release            chan struct{}
	once               sync.Once
}

func (factory *contextBlockingSinkFactory) NewChatSink(ctx context.Context, _ session.WindowID, _ SessionReferenceDTO) (chat.EventSink, error) {
	factory.once.Do(func() { close(factory.entered) })
	select {
	case <-ctx.Done():
		close(factory.cancelled)
		return nil, ctx.Err()
	case <-factory.release:
		return nil, errors.New("test sink released")
	}
}

func TestChatSinkCreationUsesRequestCancellationContext(t *testing.T) {
	for _, test := range []struct {
		name    string
		retire  bool
		trigger func(context.CancelFunc, *Service, *session.Registry, ChatRequestDTO) error
	}{
		{name: "explicit cancel", trigger: func(_ context.CancelFunc, service *Service, _ *session.Registry, request ChatRequestDTO) error {
			return service.CancelChat(context.Background(), request.Session, request.RequestID)
		}},
		{name: "session replacement", retire: true, trigger: func(_ context.CancelFunc, _ *Service, registry *session.Registry, _ ChatRequestDTO) error {
			_, err := registry.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "Replacement"}, &onceRuntime{runtime: &bridgeRuntime{}})
			return err
		}},
		{name: "window close", retire: true, trigger: func(_ context.CancelFunc, service *Service, _ *session.Registry, _ ChatRequestDTO) error {
			return CloseWindow(service, 7)
		}},
		{name: "caller cancel", trigger: func(cancel context.CancelFunc, _ *Service, _ *session.Registry, _ ChatRequestDTO) error {
			cancel()
			return nil
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtime := &bridgeRuntime{}
			service, capability, _ := newBridgeService(t, 7, &onceRuntime{runtime: runtime})
			registry := service.sessions.(*session.Registry)
			factory := &contextBlockingSinkFactory{entered: make(chan struct{}), cancelled: make(chan struct{}), release: make(chan struct{})}
			service.streams = factory
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			request := validBridgeRequest(capability)
			result := make(chan error, 1)
			go func() { _, err := service.Chat(ctx, request); result <- err }()
			receiveBridgeResult(t, factory.entered)
			if err := test.trigger(cancel, service, registry, request); err != nil {
				close(factory.release)
				t.Fatal(err)
			}
			select {
			case <-factory.cancelled:
			case <-time.After(500 * time.Millisecond):
				close(factory.release)
				receiveBridgeResult(t, result)
				t.Fatal("sink creation did not observe request cancellation")
			}
			if err := receiveBridgeResult(t, result); !errors.Is(err, ErrChatUnavailable) {
				t.Fatalf("chat=%v", err)
			}
			runs, _ := runtime.counts()
			if runs != 0 {
				t.Fatalf("runtime runs=%d", runs)
			}
			runtime.mu.Lock()
			closes := runtime.closeCalls
			runtime.mu.Unlock()
			if test.retire && closes != 1 {
				t.Fatalf("runtime closes=%d", closes)
			}
			if !test.retire {
				service.streams = &bridgeSinkFactory{sink: &bridgeEventSink{}}
				if _, err := service.Chat(context.Background(), request); err != nil {
					t.Fatalf("request lease not released: %v", err)
				}
			}
		})
	}
}
