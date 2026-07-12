package ai

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type eventDispatcherStub struct {
	mu         sync.Mutex
	events     []*application.CustomEvent
	onDispatch func()
}

func (stub *eventDispatcherStub) DispatchWailsEvent(event *application.CustomEvent) {
	stub.mu.Lock()
	stub.events = append(stub.events, event)
	callback := stub.onDispatch
	stub.mu.Unlock()
	if callback != nil {
		callback()
	}
}

func (stub *eventDispatcherStub) snapshot() []*application.CustomEvent {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	return append([]*application.CustomEvent(nil), stub.events...)
}

func validChatEvent(requestID string) chat.Event {
	return chat.Event{Kind: chat.EventStarted, RequestID: requestID, ConversationID: "conversation-1", Seq: 1,
		Semantic: chat.SemanticInfo{Status: "disabled"}}
}

func sinkReference() SessionReferenceDTO {
	return SessionReferenceDTO{SessionID: "sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", Generation: 1}
}

func TestWailsStreamSinkDispatchesExactEventToOwningWindowOnly(t *testing.T) {
	owner, other := &eventDispatcherStub{}, &eventDispatcherStub{}
	sink, err := newWailsStreamSink(owner, sinkReference())
	if err != nil {
		t.Fatal(err)
	}
	event := validChatEvent("request-1")
	if err := sink.OnEvent(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	events := owner.snapshot()
	if len(events) != 1 || len(other.snapshot()) != 0 {
		t.Fatalf("owner=%d other=%d", len(events), len(other.snapshot()))
	}
	want := ChatEventDTO{Session: sinkReference(), Event: ChatStreamEventDTO{
		Kind: "started", RequestID: "request-1", ConversationID: "conversation-1", Seq: 1,
		Semantic: SemanticDTO{Status: "disabled"}, CitationDiagnostics: CitationDiagnosticsDTO{},
	}}
	if events[0].Name != WailsChatEventName || !reflect.DeepEqual(events[0].Data, want) {
		t.Fatalf("event=%#v", events[0])
	}
}

func TestWailsStreamSinkRejectsCancelledContextAndInvalidIDsWithoutDispatch(t *testing.T) {
	dispatcher := &eventDispatcherStub{}
	sink, _ := newWailsStreamSink(dispatcher, sinkReference())
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := sink.OnEvent(cancelled, validChatEvent("request")); !errors.Is(err, ErrEventDispatch) {
		t.Fatalf("cancelled=%v", err)
	}
	invalid := []chat.Event{
		validChatEvent(""),
		validChatEvent("request/path"),
		validChatEvent(strings.Repeat("a", chat.MaxRequestIDBytes+1)),
		validChatEvent(string([]byte{0xff})),
		{Kind: chat.EventStarted, RequestID: "request", ConversationID: "bad/path", Seq: 1},
	}
	for _, event := range invalid {
		if err := sink.OnEvent(context.Background(), event); !errors.Is(err, ErrEventDispatch) {
			t.Fatalf("kind=%q err=%v", event.Kind, err)
		}
	}
	if len(dispatcher.snapshot()) != 0 {
		t.Fatalf("dispatches=%d", len(dispatcher.snapshot()))
	}
}

func TestWailsStreamSinkRejectsUnboundedOrMalformedEventPayloads(t *testing.T) {
	dispatcher := &eventDispatcherStub{}
	sink, _ := newWailsStreamSink(dispatcher, sinkReference())
	base := validChatEvent("request")
	invalid := []chat.Event{
		{Kind: chat.EventDelta, RequestID: base.RequestID, ConversationID: base.ConversationID, Seq: 2,
			Semantic: base.Semantic, Delta: strings.Repeat("x", history.MaxAssistantBytes+1)},
		{Kind: chat.EventCitation, RequestID: base.RequestID, ConversationID: base.ConversationID, Seq: 2,
			Semantic: base.Semantic, Citation: &chat.CitationDTO{ModelID: "S1", CitationID: bridgeCitationID, Path: "/private/root.md"}},
		{Kind: chat.EventUsage, RequestID: base.RequestID, ConversationID: base.ConversationID, Seq: 2,
			Semantic: base.Semantic, Usage: &providers.Usage{InputTokens: -1}},
		{Kind: chat.EventFailed, RequestID: base.RequestID, ConversationID: base.ConversationID, Seq: 2,
			Semantic: base.Semantic, ErrorCode: "raw/private/error"},
		{Kind: chat.EventStarted, RequestID: base.RequestID, ConversationID: base.ConversationID, Seq: 2,
			Semantic: base.Semantic, Delta: "unexpected"},
	}
	for _, event := range invalid {
		if err := sink.OnEvent(context.Background(), event); !errors.Is(err, ErrEventDispatch) {
			t.Fatalf("event=%#v err=%v", event, err)
		}
	}
	if len(dispatcher.snapshot()) != 0 {
		t.Fatalf("dispatches=%d", len(dispatcher.snapshot()))
	}
}

func TestWailsStreamSinkSupportsConcurrentAndReentrantDispatch(t *testing.T) {
	dispatcher := &eventDispatcherStub{}
	sink, _ := newWailsStreamSink(dispatcher, sinkReference())
	var reentered atomic.Bool
	dispatcher.onDispatch = func() {
		if reentered.CompareAndSwap(false, true) {
			if err := sink.OnEvent(context.Background(), validChatEvent("reentrant")); err != nil {
				t.Errorf("reentrant: %v", err)
			}
		}
	}
	if err := sink.OnEvent(context.Background(), validChatEvent("initial")); err != nil {
		t.Fatal(err)
	}
	const count = 100
	var wait sync.WaitGroup
	for index := range count {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			if err := sink.OnEvent(context.Background(), validChatEvent("request-"+string(rune('A'+index%26)))); err != nil {
				t.Errorf("dispatch: %v", err)
			}
		}(index)
	}
	wait.Wait()
	if got := len(dispatcher.snapshot()); got != count+2 {
		t.Fatalf("dispatches=%d", got)
	}
}

func TestWailsStreamSinkConstructorsRejectTypedNil(t *testing.T) {
	var dispatcher *eventDispatcherStub
	if _, err := newWailsStreamSink(dispatcher, sinkReference()); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("dispatcher=%v", err)
	}
	var window *application.WebviewWindow
	if _, err := NewWailsStreamSink(window, sinkReference()); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("window=%v", err)
	}
}

func TestWailsStreamSinkFactoryRejectsMismatchedOwningWindow(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "sink-owner"})
	ctx := context.WithValue(context.Background(), application.WindowKey, window)
	factory := NewWailsStreamSinkFactory()
	if _, err := factory.NewChatSink(ctx, session.WindowID(window.ID()+1), sinkReference()); !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("err=%v", err)
	}
}

func TestWailsStreamSinkFactoryBindsMatchingOwnerAndSession(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "matching-sink-owner"})
	ctx := context.WithValue(context.Background(), application.WindowKey, window)
	created, err := NewWailsStreamSinkFactory().NewChatSink(ctx, session.WindowID(window.ID()), sinkReference())
	if err != nil {
		t.Fatal(err)
	}
	sink, ok := created.(*WailsStreamSink)
	if !ok || sink.reference != sinkReference() || !reflect.DeepEqual(sink.dispatcher, window) {
		t.Fatalf("sink=%#v", created)
	}
}

var _ chat.EventSink = (*WailsStreamSink)(nil)
