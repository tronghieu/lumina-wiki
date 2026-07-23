package main

import (
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type windowLifecycle interface {
	ID() uint
	RegisterHook(events.WindowEventType, func(*application.WindowEvent)) func()
}

func registerAIWindowCleanup(window windowLifecycle, closeWindow func(session.WindowID) error) {
	window.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
		_ = closeWindow(session.WindowID(window.ID()))
	})
}
