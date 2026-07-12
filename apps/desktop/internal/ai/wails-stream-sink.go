package ai

import (
	"context"
	"regexp"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const WailsChatEventName = "lumina:chat:event"

var chatEventIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

type wailsEventDispatcher interface {
	DispatchWailsEvent(*application.CustomEvent)
}

type WailsStreamSink struct {
	dispatcher wailsEventDispatcher
}

func NewWailsStreamSink(window application.Window) (*WailsStreamSink, error) {
	if !hasValue(window) {
		return nil, ErrInvalidInput
	}
	return newWailsStreamSink(window)
}

func newWailsStreamSink(dispatcher wailsEventDispatcher) (*WailsStreamSink, error) {
	if !hasValue(dispatcher) {
		return nil, ErrInvalidInput
	}
	return &WailsStreamSink{dispatcher: dispatcher}, nil
}

// OnEvent dispatches directly to one owning window without an internal queue.
// Wails exposes no delivery acknowledgement, so nil means only that dispatch
// was accepted synchronously; it cannot guarantee frontend receipt.
func (sink *WailsStreamSink) OnEvent(ctx context.Context, event chat.Event) error {
	if sink == nil || !hasValue(sink.dispatcher) || ctx == nil || ctx.Err() != nil ||
		!validChatEventID(event.RequestID) || !validChatEventID(event.ConversationID) {
		return ErrEventDispatch
	}
	sink.dispatcher.DispatchWailsEvent(&application.CustomEvent{Name: WailsChatEventName, Data: event})
	return nil
}

func validChatEventID(value string) bool {
	return value != "" && len(value) <= chat.MaxRequestIDBytes && utf8.ValidString(value) && chatEventIDPattern.MatchString(value)
}
