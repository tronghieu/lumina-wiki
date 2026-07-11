package providers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"unicode/utf8"
)

type EventKind string

const (
	EventDelta   EventKind = "delta"
	EventUsage   EventKind = "usage"
	EventRefusal EventKind = "refusal"
	EventError   EventKind = "error"
)

type Delta struct{ Text string }
type Usage struct{ InputTokens, OutputTokens, TotalTokens int }
type Refusal struct{ Message string }

type StreamEvent struct {
	Kind    EventKind
	Delta   *Delta
	Usage   *Usage
	Refusal *Refusal
	Error   *SafeError
}

type ChatMessage struct{ Role, Content string }
type ProviderRequest struct {
	Model           string
	System          string
	Turns           []ChatMessage
	MaxOutputTokens int
}

const maxProviderTextBytes = 4 << 20

const (
	MaxProviderTurns        = 256
	MaxProviderTurnChars    = 1 << 20
	MaxProviderRequestChars = 8 << 20
	MaxProviderRequestBytes = 8 << 20
)

func (r ProviderRequest) Validate() error {
	if !validProviderText(r.Model, false) || !validProviderText(r.System, true) || len(r.Turns) == 0 || len(r.Turns) > MaxProviderTurns || r.MaxOutputTokens < 0 || r.MaxOutputTokens > 100_000 {
		return NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	chars, estimatedBytes := 0, 512
	if !addWithin(&chars, utf8.RuneCountInString(r.Model), MaxProviderRequestChars) || !addWithin(&chars, utf8.RuneCountInString(r.System), MaxProviderRequestChars) || !addJSONEstimate(&estimatedBytes, r.Model) || !addJSONEstimate(&estimatedBytes, r.System) {
		return NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	for _, turn := range r.Turns {
		turnChars := utf8.RuneCountInString(turn.Content)
		if (turn.Role != "user" && turn.Role != "assistant") || !validProviderText(turn.Content, false) || turnChars > MaxProviderTurnChars || !addWithin(&chars, turnChars, MaxProviderRequestChars) || !addWithin(&estimatedBytes, 64, MaxProviderRequestBytes) || !addJSONEstimate(&estimatedBytes, turn.Content) {
			return NewSafeError("invalid_request", "The provider request is invalid.", nil)
		}
	}
	if r.Turns[len(r.Turns)-1].Role != "user" {
		return NewSafeError("invalid_request", "The provider request must end with a user message.", nil)
	}
	return nil
}

func addWithin(total *int, value, limit int) bool {
	if value < 0 || *total > limit-value {
		return false
	}
	*total += value
	return true
}

func addJSONEstimate(total *int, value string) bool {
	encoded := 2
	for _, r := range value {
		n := utf8.RuneLen(r)
		if r < 0x20 || r == '<' || r == '>' || r == '&' || r == '\u2028' || r == '\u2029' {
			n = 6
		} else if r == '"' || r == '\\' {
			n = 2
		}
		if !addWithin(&encoded, n, MaxProviderRequestBytes) {
			return false
		}
	}
	return addWithin(total, encoded, MaxProviderRequestBytes)
}

func validProviderText(value string, empty bool) bool {
	return (empty || value != "") && len(value) <= maxProviderTextBytes && utf8.ValidString(value)
}

type ChatRequest = ProviderRequest

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
