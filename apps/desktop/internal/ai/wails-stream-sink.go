package ai

import (
	"context"
	"regexp"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const WailsChatEventName = "lumina:chat:event"

var chatEventIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

type wailsEventDispatcher interface {
	DispatchWailsEvent(*application.CustomEvent)
}

type WailsStreamSink struct {
	dispatcher wailsEventDispatcher
	reference  SessionReferenceDTO
}

func NewWailsStreamSink(window application.Window, reference SessionReferenceDTO) (*WailsStreamSink, error) {
	if !hasValue(window) || !validSessionReferenceSyntax(reference) {
		return nil, ErrInvalidInput
	}
	return newWailsStreamSink(window, reference)
}

func newWailsStreamSink(dispatcher wailsEventDispatcher, reference SessionReferenceDTO) (*WailsStreamSink, error) {
	if !hasValue(dispatcher) || !validSessionReferenceSyntax(reference) {
		return nil, ErrInvalidInput
	}
	return &WailsStreamSink{dispatcher: dispatcher, reference: reference}, nil
}

// OnEvent dispatches directly to one owning window without an internal queue.
// Wails exposes no delivery acknowledgement, so nil means only that dispatch
// was accepted synchronously; it cannot guarantee frontend receipt.
func (sink *WailsStreamSink) OnEvent(ctx context.Context, event chat.Event) error {
	if sink == nil || !hasValue(sink.dispatcher) || ctx == nil || ctx.Err() != nil ||
		!validWailsChatEvent(event) {
		return ErrEventDispatch
	}
	sink.dispatcher.DispatchWailsEvent(&application.CustomEvent{
		Name: WailsChatEventName,
		Data: ChatEventDTO{Session: sink.reference, Event: newChatStreamEventDTO(event)},
	})
	return nil
}

type WailsStreamSinkFactory struct{}

func NewWailsStreamSinkFactory() *WailsStreamSinkFactory { return &WailsStreamSinkFactory{} }

func (*WailsStreamSinkFactory) NewChatSink(ctx context.Context, expected session.WindowID, reference SessionReferenceDTO) (chat.EventSink, error) {
	if ctx == nil || ctx.Err() != nil || expected == 0 {
		return nil, ErrWindowUnavailable
	}
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok || !hasValue(window) || session.WindowID(window.ID()) != expected {
		return nil, ErrWindowUnavailable
	}
	return NewWailsStreamSink(window, reference)
}

func validChatEventID(value string) bool {
	return value != "" && len(value) <= chat.MaxRequestIDBytes && utf8.ValidString(value) && chatEventIDPattern.MatchString(value)
}
