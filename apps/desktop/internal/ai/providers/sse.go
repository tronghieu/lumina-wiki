package providers

import (
	"context"
	"errors"
	"io"
	"strings"
)

const (
	MaxSSELineBytes  = 256 << 10
	MaxSSEEventBytes = 1 << 20
	MaxSSETotalBytes = 16 << 20
	MaxSSEEvents     = 100_000
)

type Limits struct{ MaxLineBytes, MaxEventBytes, MaxTotalBytes, MaxEvents int }

func (l Limits) WithDefaults() Limits {
	if l.MaxLineBytes == 0 {
		l.MaxLineBytes = 64 << 10
	}
	if l.MaxEventBytes == 0 {
		l.MaxEventBytes = 256 << 10
	}
	if l.MaxTotalBytes == 0 {
		l.MaxTotalBytes = 8 << 20
	}
	if l.MaxEvents == 0 {
		l.MaxEvents = 10_000
	}
	return l
}
func (l Limits) Validate() error {
	if l.MaxLineBytes < 1 || l.MaxLineBytes > MaxSSELineBytes || l.MaxEventBytes < 1 || l.MaxEventBytes > MaxSSEEventBytes || l.MaxTotalBytes < 1 || l.MaxTotalBytes > MaxSSETotalBytes || l.MaxEvents < 1 || l.MaxEvents > MaxSSEEvents {
		return errors.New("invalid SSE limits")
	}
	return nil
}

type SSEEvent struct {
	Event, Data, ID string
	Retry           int
}

func ParseSSE(ctx context.Context, reader io.Reader, limits Limits, callback func(SSEEvent) error) error {
	limits = limits.WithDefaults()
	if err := limits.Validate(); err != nil {
		return err
	}
	if callback == nil {
		return errors.New("SSE callback is required")
	}
	if reader == nil {
		return NewSafeError("invalid_reader", "The provider stream reader is invalid.", nil)
	}
	if closer, ok := reader.(io.Closer); ok {
		parseDone := make(chan struct{})
		watcherDone := make(chan struct{})
		go func() {
			defer close(watcherDone)
			select {
			case <-ctx.Done():
				_ = closer.Close()
			case <-parseDone:
			}
		}()
		err := parseSSEStream(ctx, reader, limits, callback)
		close(parseDone)
		<-watcherDone
		if ctx.Err() != nil {
			return safeFailure("stream_canceled", "The provider stream was canceled.", ctx.Err())
		}
		return err
	}
	return parseSSEStream(ctx, reader, limits, callback)
}

func splitSSEField(line string) (string, string) {
	field, value, ok := strings.Cut(line, ":")
	if !ok {
		return line, ""
	}
	if strings.HasPrefix(value, " ") {
		value = value[1:]
	}
	return field, value
}
