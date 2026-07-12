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
	return chat.Event{Kind: chat.EventStarted, RequestID: requestID, ConversationID: "conversation-1", Seq: 1}
}

func TestWailsStreamSinkDispatchesExactEventToOwningWindowOnly(t *testing.T) {
	owner, other := &eventDispatcherStub{}, &eventDispatcherStub{}
	sink, err := newWailsStreamSink(owner)
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
	if events[0].Name != WailsChatEventName || !reflect.DeepEqual(events[0].Data, event) {
		t.Fatalf("event=%#v", events[0])
	}
}

func TestWailsStreamSinkRejectsCancelledContextAndInvalidIDsWithoutDispatch(t *testing.T) {
	dispatcher := &eventDispatcherStub{}
	sink, _ := newWailsStreamSink(dispatcher)
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
			t.Fatalf("event=%#v err=%v", event, err)
		}
	}
	if len(dispatcher.snapshot()) != 0 {
		t.Fatalf("dispatches=%d", len(dispatcher.snapshot()))
	}
}

func TestWailsStreamSinkSupportsConcurrentAndReentrantDispatch(t *testing.T) {
	dispatcher := &eventDispatcherStub{}
	sink, _ := newWailsStreamSink(dispatcher)
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
	if _, err := newWailsStreamSink(dispatcher); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("dispatcher=%v", err)
	}
	var window *application.WebviewWindow
	if _, err := NewWailsStreamSink(window); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("window=%v", err)
	}
}

var _ chat.EventSink = (*WailsStreamSink)(nil)
