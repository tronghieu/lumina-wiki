package providers

import (
	"context"
	"errors"
	"time"
)

type RetryObservation struct {
	Attempt int
	Code    string
}

type RetryOptions struct {
	Timeout  time.Duration
	Backoff  time.Duration
	Clock    func() time.Time
	Sleep    func(context.Context, time.Duration) error
	Observer func(RetryObservation)
}

type retryingProvider struct {
	provider ChatProvider
	options  RetryOptions
}

func NewRetryingProvider(provider ChatProvider, options RetryOptions) ChatProvider {
	if provider == nil {
		return nil
	}
	if _, ok := provider.(*retryingProvider); ok {
		return provider
	}
	options = normalizeRetryOptions(options)
	return &retryingProvider{provider: provider, options: options}
}

func normalizeRetryOptions(options RetryOptions) RetryOptions {
	if options.Backoff <= 0 {
		options.Backoff = 250 * time.Millisecond
	}
	if options.Clock == nil {
		options.Clock = time.Now
	}
	if options.Sleep == nil {
		options.Sleep = sleepWithContext
	}
	return options
}

func (p *retryingProvider) Stream(parent context.Context, request ChatRequest, sink StreamSink) error {
	if parent == nil {
		return NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	ctx, cancel := parent, func() {}
	if p.options.Timeout > 0 {
		ctx, cancel = context.WithTimeout(parent, p.options.Timeout)
	}
	defer cancel()
	for attempt := 1; attempt <= 2; attempt++ {
		guard := &attemptSink{sink: sink}
		err := p.provider.Stream(ctx, request, guard)
		if guard.sinkErr != nil {
			return guard.sinkErr
		}
		if err == nil || attempt == 2 || guard.emitted || !isRetryable(err) {
			return canonicalContextError(ctx, err)
		}
		var safe *SafeError
		_ = errors.As(err, &safe)
		if p.options.Observer != nil {
			p.options.Observer(RetryObservation{Attempt: attempt, Code: safe.Code})
		}
		delay := p.options.Backoff
		if safe.hasRetryAfter {
			delay = safe.retryAfter
		}
		if err := p.options.Sleep(ctx, delay); err != nil {
			return canonicalContextError(ctx, NewSafeError("retry_wait", "The provider retry was interrupted.", err))
		}
	}
	return nil
}

type attemptSink struct {
	sink    StreamSink
	emitted bool
	sinkErr error
}

func (s *attemptSink) OnEvent(ctx context.Context, event StreamEvent) error {
	if s.sink == nil {
		s.sinkErr = NewSafeError("invalid_sink", "The provider stream sink is invalid.", nil)
		return s.sinkErr
	}
	err := s.sink.OnEvent(ctx, event)
	if err != nil {
		s.sinkErr = err
		return err
	}
	s.emitted = true
	return nil
}

func isRetryable(err error) bool {
	var safe *SafeError
	return errors.As(err, &safe) && safe.retryable
}

func canonicalContextError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
