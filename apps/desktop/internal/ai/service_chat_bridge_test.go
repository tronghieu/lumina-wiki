package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

func TestChatRejectsCrossWindowBeforeSinkOrRuntime(t *testing.T) {
	runtime := &bridgeRuntime{}
	service, capability, streams := newBridgeService(t, 8, runtime)
	_, err := service.Chat(context.Background(), validBridgeRequest(capability))
	if !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("err=%v", err)
	}
	runs, reads := runtime.counts()
	if streams.callCount() != 0 || runs != 0 || reads != 0 {
		t.Fatalf("sink=%d runs=%d reads=%d", streams.callCount(), runs, reads)
	}
}

func TestChatBeginRequestDuplicateAndExplicitCancel(t *testing.T) {
	runtime := &bridgeRuntime{entered: make(chan struct{}), contextDone: make(chan struct{}), waitForCancel: true}
	service, capability, streams := newBridgeService(t, 7, &onceRuntime{runtime: runtime})
	request := validBridgeRequest(capability)
	result := make(chan error, 1)
	go func() { _, err := service.Chat(context.Background(), request); result <- err }()
	receiveBridgeResult(t, runtime.entered)
	if _, err := service.Chat(context.Background(), request); !errors.Is(err, ErrChatRequestActive) {
		t.Fatalf("duplicate=%v", err)
	}
	if err := service.CancelChat(context.Background(), request.Session, request.RequestID); err != nil {
		t.Fatal(err)
	}
	receiveBridgeResult(t, runtime.contextDone)
	if err := receiveBridgeResult(t, result); !errors.Is(err, ErrChatUnavailable) {
		t.Fatalf("chat=%v", err)
	}
	if streams.callCount() != 1 {
		t.Fatalf("sink calls=%d", streams.callCount())
	}
}

func TestChatForwardsOnlyNormalizedSafeRequestAndFinishesOnError(t *testing.T) {
	runtime := &bridgeRuntime{runErr: errors.New("raw /private/root secret")}
	service, capability, _ := newBridgeService(t, 7, &onceRuntime{runtime: runtime})
	request := validBridgeRequest(capability)
	if _, err := service.Chat(context.Background(), request); !errors.Is(err, ErrChatUnavailable) || errors.Is(err, runtime.runErr) {
		t.Fatalf("first=%v", err)
	}
	runtime.mu.Lock()
	runtime.runErr = nil
	runtime.mu.Unlock()
	completion, err := service.Chat(context.Background(), request)
	if err != nil || completion != (ChatCompletionDTO{RequestID: "request", ConversationID: "conversation"}) {
		t.Fatalf("completion=%#v err=%v", completion, err)
	}
	if runtime.request.Question != request.Question || runtime.request.Profiles != request.Profiles || runtime.request.History != request.History {
		t.Fatalf("runtime request=%#v", runtime.request)
	}
}

func TestChatRejectsTypedNilRuntimeCapability(t *testing.T) {
	var typedNil *bridgeRuntime
	service, capability, streams := newBridgeService(t, 7, &onceRuntime{runtime: typedNil})
	if _, err := service.Chat(context.Background(), validBridgeRequest(capability)); !errors.Is(err, ErrChatUnavailable) {
		t.Fatalf("err=%v", err)
	}
	if streams.callCount() != 0 {
		t.Fatalf("sink=%d", streams.callCount())
	}
}

type nilUnsafeRuntime struct{ value int }

func (runtime *nilUnsafeRuntime) Close() error { runtime.value++; return nil }
func (*nilUnsafeRuntime) RunChat(context.Context, runtimeChatRequest, chat.EventSink) error {
	return nil
}
func (*nilUnsafeRuntime) ReadCitationNote(context.Context, string, string) (retrieval.CitationNote, error) {
	return retrieval.CitationNote{}, nil
}

func TestOnceRuntimeCloseDoesNotCallTypedNilUnderlying(t *testing.T) {
	var typedNil *nilUnsafeRuntime
	wrapper := &onceRuntime{runtime: typedNil}
	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("Close panicked: %v", recovered)
		}
	}()
	if err := wrapper.Close(); err != nil {
		t.Fatalf("err=%v", err)
	}
}

func TestChatRejectsInvalidDTOBeforeSessionLookup(t *testing.T) {
	runtime := &bridgeRuntime{}
	service, capability, streams := newBridgeService(t, 7, runtime)
	request := validBridgeRequest(capability)
	request.SelectedPath = "/private/root/wiki/a.md"
	if _, err := service.Chat(context.Background(), request); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("err=%v", err)
	}
	runs, _ := runtime.counts()
	if streams.callCount() != 0 || runs != 0 {
		t.Fatalf("sink=%d runs=%d", streams.callCount(), runs)
	}
}

var _ session.Runtime = (*bridgeRuntime)(nil)
