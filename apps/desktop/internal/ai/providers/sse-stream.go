package providers

import (
	"context"
	"errors"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"
)

type streamDecoder struct {
	ctx                context.Context
	limits             Limits
	callback           func(SSEEvent) error
	line               []byte
	event              SSEEvent
	data               []string
	eventBytes, events int
	lastID             string
	firstLine, skipLF  bool
}

func parseSSEStream(ctx context.Context, reader io.Reader, limits Limits, callback func(SSEEvent) error) error {
	d := &streamDecoder{ctx: ctx, limits: limits, callback: callback, firstLine: true, line: make([]byte, 0, min(limits.MaxLineBytes, 4096))}
	chunk, total := make([]byte, 4096), 0
	zeroReads := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := reader.Read(chunk)
		if n > 0 {
			zeroReads = 0
			total += n
			if total > limits.MaxTotalBytes {
				return streamLimit("The provider stream exceeded its size limit.")
			}
			if err := d.consume(chunk[:n]); err != nil {
				return err
			}
		}
		if n == 0 && readErr == nil {
			zeroReads++
			if zeroReads >= 32 {
				return NewSafeError("stream_no_progress", "The provider stream stopped making progress.", io.ErrNoProgress)
			}
		}
		if readErr != nil {
			if err := ctx.Err(); err != nil {
				return err
			}
			if errors.Is(readErr, io.EOF) {
				return d.finish()
			}
			return safeFailure("stream_read", "The provider stream could not be read.", readErr)
		}
	}
}

func (d *streamDecoder) consume(raw []byte) error {
	for _, b := range raw {
		if d.skipLF {
			d.skipLF = false
			if b == '\n' {
				continue
			}
		}
		if b == '\r' || b == '\n' {
			if err := d.acceptLine(); err != nil {
				return err
			}
			d.skipLF = b == '\r'
			continue
		}
		if len(d.line) >= d.limits.MaxLineBytes {
			return streamLimit("A provider stream line exceeded its size limit.")
		}
		d.line = append(d.line, b)
	}
	return nil
}

func (d *streamDecoder) acceptLine() error {
	line := d.line
	d.line = d.line[:0]
	if d.firstLine {
		d.firstLine = false
		if len(line) >= 3 && string(line[:3]) == "\xef\xbb\xbf" {
			line = line[3:]
		}
	}
	if !utf8.Valid(line) || strings.Contains(string(line), "\ufeff") {
		return NewSafeError("stream_encoding", "The provider stream used invalid text encoding.", nil)
	}
	d.eventBytes += len(line)
	if d.eventBytes > d.limits.MaxEventBytes {
		return streamLimit("A provider stream event exceeded its size limit.")
	}
	if len(line) == 0 {
		return d.dispatch()
	}
	if line[0] == ':' {
		return nil
	}
	field, value := splitSSEField(string(line))
	switch field {
	case "data":
		d.data = append(d.data, value)
	case "event":
		d.event.Event = value
	case "id":
		if !strings.ContainsRune(value, 0) {
			d.lastID = value
		}
	case "retry":
		if n, err := strconv.Atoi(value); err == nil && n >= 0 {
			d.event.Retry = n
		}
	}
	return nil
}

func (d *streamDecoder) dispatch() error {
	if len(d.data) > 0 {
		if d.events >= d.limits.MaxEvents {
			return streamLimit("The provider stream contained too many events.")
		}
		d.event.Data = strings.Join(d.data, "\n")
		d.event.ID = d.lastID
		if d.event.Event == "" {
			d.event.Event = "message"
		}
		if err := d.ctx.Err(); err != nil {
			return err
		}
		if err := d.callback(d.event); err != nil {
			return err
		}
		d.events++
	}
	d.event = SSEEvent{}
	d.data = nil
	d.eventBytes = 0
	return nil
}
func (d *streamDecoder) finish() error {
	if len(d.line) > 0 {
		if err := d.acceptLine(); err != nil {
			return err
		}
	}
	return d.dispatch()
}
func streamLimit(message string) error { return NewSafeError("stream_limit", message, nil) }
