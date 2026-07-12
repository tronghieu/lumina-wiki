package ai

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type bridgeEventSink struct {
	mu     sync.Mutex
	events []chat.Event
}

func (sink *bridgeEventSink) OnEvent(_ context.Context, event chat.Event) error {
	sink.mu.Lock()
	sink.events = append(sink.events, event)
	sink.mu.Unlock()
	return nil
}

type bridgeSinkFactory struct {
	mu        sync.Mutex
	calls     int
	window    session.WindowID
	reference SessionReferenceDTO
	sink      chat.EventSink
	err       error
}

func (factory *bridgeSinkFactory) NewChatSink(_ context.Context, window session.WindowID, reference SessionReferenceDTO) (chat.EventSink, error) {
	factory.mu.Lock()
	defer factory.mu.Unlock()
	factory.calls++
	factory.window, factory.reference = window, reference
	return factory.sink, factory.err
}

func (factory *bridgeSinkFactory) callCount() int {
	factory.mu.Lock()
	defer factory.mu.Unlock()
	return factory.calls
}

type bridgeRuntime struct {
	mu            sync.Mutex
	runCalls      int
	readCalls     int
	request       runtimeChatRequest
	runErr        error
	readErr       error
	note          retrieval.CitationNote
	entered       chan struct{}
	contextDone   chan struct{}
	waitForCancel bool
	closeCalls    int
}

func (runtime *bridgeRuntime) RunChat(ctx context.Context, request runtimeChatRequest, _ chat.EventSink) error {
	runtime.mu.Lock()
	runtime.runCalls++
	runtime.request = request
	entered, wait, result := runtime.entered, runtime.waitForCancel, runtime.runErr
	runtime.mu.Unlock()
	if entered != nil {
		select {
		case <-entered:
		default:
			close(entered)
		}
	}
	if wait {
		<-ctx.Done()
		if runtime.contextDone != nil {
			close(runtime.contextDone)
		}
		return ctx.Err()
	}
	return result
}

func (runtime *bridgeRuntime) ReadCitationNote(_ context.Context, requestID, citationID string) (retrieval.CitationNote, error) {
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	runtime.readCalls++
	if requestID != "request" || citationID != "cit_0123456789abcdef0123456789abcdef" {
		return retrieval.CitationNote{}, errors.New("private unknown citation")
	}
	return runtime.note, runtime.readErr
}

func (runtime *bridgeRuntime) Close() error {
	runtime.mu.Lock()
	runtime.closeCalls++
	runtime.mu.Unlock()
	return nil
}

func (runtime *bridgeRuntime) counts() (int, int) {
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.runCalls, runtime.readCalls
}

func bridgeReference(capability session.Capability) SessionReferenceDTO {
	return SessionReferenceDTO{SessionID: capability.SessionID, Generation: capability.Generation}
}

func validBridgeRequest(capability session.Capability) ChatRequestDTO {
	return ChatRequestDTO{
		Session: bridgeReference(capability), RequestID: "request", ConversationID: "conversation",
		Question: "What is grounded?", Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"},
		History: ChatHistoryOptionsDTO{Include: true, Persist: true}, SelectedPath: "wiki/concepts/privacy.md",
		LinkedPaths: []string{"wiki/concepts/security.md"},
	}
}

func newBridgeService(t testingT, window session.WindowID, runtime session.Runtime) (*Service, session.Capability, *bridgeSinkFactory) {
	registry := session.NewRegistry(session.Options{})
	capability, err := registry.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "Workspace"}, runtime)
	if err != nil {
		t.Fatal(err)
	}
	log := &callLog{}
	streams := &bridgeSinkFactory{sink: &bridgeEventSink{}}
	service, err := NewService(Dependencies{
		Windows: &windowResolverStub{log: log, window: window}, Native: &nativeAuthorityStub{log: log},
		Validator: &validatorStub{log: log}, Attacher: &attacherStub{log: log},
		Runtimes: &runtimeFactoryStub{log: log, runtime: runtime}, Sessions: registry, Streams: streams,
	})
	if err != nil {
		t.Fatal(err)
	}
	return service, capability, streams
}

type testingT interface{ Fatal(...any) }

func receiveBridgeResult[T any](t testingT, channel <-chan T) T {
	select {
	case result := <-channel:
		return result
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for bridge result")
		var zero T
		return zero
	}
}
