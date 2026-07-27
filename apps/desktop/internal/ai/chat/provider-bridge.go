package chat

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

type providerBridge struct {
	guard          *TerminalGuard
	output         []byte
	usage          *providers.Usage
	failureCode    string
	acceptedDeltas int
}

func (bridge *providerBridge) OnEvent(ctx context.Context, event providers.StreamEvent) error {
	switch event.Kind {
	case providers.EventDelta:
		if event.Delta == nil || event.Usage != nil || event.Refusal != nil || event.Error != nil || !utf8.ValidString(event.Delta.Text) {
			bridge.failureCode = "invalid_provider_event"
			return ErrInvalidStream
		}
		if event.Delta.Text == "" {
			return nil
		}
		if len(bridge.output) > history.MaxAssistantBytes-len(event.Delta.Text) {
			bridge.failureCode = "output_limit"
			bridge.guard.cancel()
			return ErrStreamLimit
		}
		if err := bridge.guard.Emit(ctx, Event{Kind: EventDelta, Delta: event.Delta.Text}); err != nil {
			if errors.Is(err, ErrSink) {
				bridge.failureCode = "sink_failed"
			} else {
				bridge.failureCode = "event_limit"
			}
			return err
		}
		bridge.output = append(bridge.output, event.Delta.Text...)
		bridge.acceptedDeltas++
		return nil
	case providers.EventUsage:
		if !validProviderUsage(event) || event.Usage.InputTokens < 0 || event.Usage.OutputTokens < 0 || event.Usage.TotalTokens < 0 || bridge.usage != nil {
			bridge.failureCode = "invalid_provider_event"
			return ErrInvalidStream
		}
		copy := *event.Usage
		bridge.usage = &copy
		return nil
	case providers.EventRefusal:
		if event.Refusal == nil || event.Delta != nil || event.Usage != nil || event.Error != nil {
			bridge.failureCode = "invalid_provider_event"
			return ErrInvalidStream
		}
		bridge.failureCode = "provider_refusal"
		return errProviderStopped
	case providers.EventError:
		if event.Error == nil || event.Delta != nil || event.Usage != nil || event.Refusal != nil {
			bridge.failureCode = "invalid_provider_event"
			return ErrInvalidStream
		}
		bridge.failureCode = providerErrorCode(event.Error)
		return errProviderStopped
	default:
		bridge.failureCode = "invalid_provider_event"
		return ErrInvalidStream
	}
}

func validProviderUsage(event providers.StreamEvent) bool {
	return event.Usage != nil && event.Delta == nil && event.Refusal == nil && event.Error == nil
}

func providerErrorCode(err *providers.SafeError) string {
	if err != nil && safeCodePattern.MatchString(err.Code) {
		return err.Code
	}
	return "provider_error"
}

func classifyOutcome(parent, ctx context.Context, streamErr error, callbackCode string) (history.TerminalStatus, string) {
	if errors.Is(parent.Err(), context.DeadlineExceeded) {
		return history.StatusCancelled, "deadline_exceeded"
	}
	if errors.Is(parent.Err(), context.Canceled) {
		return history.StatusCancelled, "cancelled"
	}
	if callbackCode != "" {
		return history.StatusFailed, callbackCode
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(streamErr, context.DeadlineExceeded) {
		return history.StatusCancelled, "deadline_exceeded"
	}
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(streamErr, context.Canceled) {
		return history.StatusCancelled, "cancelled"
	}
	if streamErr != nil {
		callbackCode = providerErrorCodeFromError(streamErr)
		return history.StatusFailed, callbackCode
	}
	return history.StatusCompleted, ""
}

func providerErrorCodeFromError(err error) string {
	var safe *providers.SafeError
	if errors.As(err, &safe) {
		return providerErrorCode(safe)
	}
	return "provider_error"
}

var errProviderStopped = errors.New("provider stream stopped")
