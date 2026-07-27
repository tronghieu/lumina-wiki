package ai

import (
	"context"
	"reflect"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type WailsWindowResolver struct{}

func NewWailsWindowResolver() *WailsWindowResolver {
	return &WailsWindowResolver{}
}

func (*WailsWindowResolver) ResolveWindow(ctx context.Context) (session.WindowID, error) {
	if ctx == nil || ctx.Err() != nil {
		return 0, ErrWindowUnavailable
	}
	window, ok := ctx.Value(application.WindowKey).(application.Window)
	if !ok || !hasValue(window) {
		return 0, ErrWindowUnavailable
	}
	id := window.ID()
	if id == 0 {
		return 0, ErrWindowUnavailable
	}
	return session.WindowID(id), nil
}

func hasValue(value any) bool {
	if value == nil {
		return false
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return !reflected.IsNil()
	default:
		return true
	}
}
