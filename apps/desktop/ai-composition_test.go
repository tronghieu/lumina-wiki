package main

import (
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	desktopworkspace "github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func TestNewAIServiceBuildsFromTrustedPlatformRoot(t *testing.T) {
	app := application.New(application.Options{Name: "Lumina Desktop Test"})
	service, err := newAIService(app, desktopworkspace.NewService(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if service == nil {
		t.Fatal("AI service is nil")
	}
}

type lifecycleWindowStub struct {
	id       uint
	event    events.WindowEventType
	callback func(*application.WindowEvent)
}

func (window *lifecycleWindowStub) ID() uint { return window.id }

func (window *lifecycleWindowStub) RegisterHook(event events.WindowEventType, callback func(*application.WindowEvent)) func() {
	window.event = event
	window.callback = callback
	return func() {}
}

func TestRegisterAIWindowCleanupUsesClosingHookAndNativeWindowID(t *testing.T) {
	window := &lifecycleWindowStub{id: 42}
	var closed session.WindowID
	registerAIWindowCleanup(window, func(window session.WindowID) error {
		closed = window
		return nil
	})
	if window.event != events.Common.WindowClosing || window.callback == nil {
		t.Fatalf("hook event=%v callback=%v", window.event, window.callback != nil)
	}
	window.callback(application.NewWindowEvent())
	if closed != 42 {
		t.Fatalf("closed window=%d", closed)
	}
}
