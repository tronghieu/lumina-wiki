package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

type discardEventSink struct{}

func (discardEventSink) OnEvent(context.Context, chat.Event) error { return nil }

type streamSinkFactoryStub struct{}

func (streamSinkFactoryStub) NewChatSink(context.Context, session.WindowID, SessionReferenceDTO) (chat.EventSink, error) {
	return discardEventSink{}, nil
}
