package providers

import (
	"context"
	"errors"
	"io"
	"net/http"
)

type EventKind string

const (
	EventDelta   EventKind = "delta"
	EventUsage   EventKind = "usage"
	EventRefusal EventKind = "refusal"
	EventError   EventKind = "error"
)

type Delta struct{ Text string }
type Usage struct{ InputTokens, OutputTokens int }
type Refusal struct{ Message string }

type StreamEvent struct {
	Kind    EventKind
	Delta   *Delta
	Usage   *Usage
	Refusal *Refusal
	Error   *SafeError
}

type ChatMessage struct{ Role, Content string }
type ChatRequest struct {
	Model     string
	Messages  []ChatMessage
	MaxTokens int
}

type StreamSink interface {
	OnEvent(context.Context, StreamEvent) error
}
type StreamSinkFunc func(context.Context, StreamEvent) error

func (f StreamSinkFunc) OnEvent(ctx context.Context, event StreamEvent) error { return f(ctx, event) }

type ChatProvider interface {
	Stream(context.Context, ChatRequest, StreamSink) error
}
type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type SafeError struct {
	Code    string
	Message string
	cause   error
}

func NewSafeError(code, message string, cause error) *SafeError {
	if code == "" {
		code = "provider_error"
	}
	if message == "" {
		message = "The provider request failed."
	}
	var safeCause error
	if errors.Is(cause, context.Canceled) {
		safeCause = context.Canceled
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		safeCause = context.DeadlineExceeded
	}
	if errors.Is(cause, io.ErrNoProgress) {
		safeCause = io.ErrNoProgress
	}
	return &SafeError{Code: code, Message: message, cause: safeCause}
}
func (e *SafeError) Error() string { return e.Code + ": " + e.Message }
func (e *SafeError) Unwrap() error { return e.cause }
func (e *SafeError) Cause() error  { return e.cause }
func safeFailure(code, message string, cause error) error {
	if errors.Is(cause, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return NewSafeError(code, message, cause)
}
