package providers

import (
	"context"
	"errors"
	"io"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type oneByteReader struct{ r io.Reader }

func (r oneByteReader) Read(p []byte) (int, error) {
	if len(p) > 1 {
		p = p[:1]
	}
	return r.r.Read(p)
}

func TestParseSSEFragmentedMultilineAndFields(t *testing.T) {
	input := "\ufeff: hello\r\nid: 7\r\nevent: message\r\nretry: 250\r\ndata: first\r\ndata: second\r\n\r\n"
	var got []SSEEvent
	err := ParseSSE(context.Background(), oneByteReader{strings.NewReader(input)}, Limits{}, func(event SSEEvent) error { got = append(got, event); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Data != "first\nsecond" || got[0].Event != "message" || got[0].ID != "7" || got[0].Retry != 250 {
		t.Fatalf("unexpected events: %#v", got)
	}
}

func TestParseSSEEOFDispatchAndIncompleteField(t *testing.T) {
	var got []SSEEvent
	if err := ParseSSE(context.Background(), strings.NewReader("data: complete"), Limits{}, func(e SSEEvent) error { got = append(got, e); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Data != "complete" {
		t.Fatalf("unexpected %#v", got)
	}
}

func TestParseSSERejectsMalformedUTF8AndBOMAfterStart(t *testing.T) {
	for _, input := range []string{"data: \xff\n\n", "data: ok\n\ufeffdata: bad\n\n"} {
		var got []SSEEvent
		err := ParseSSE(context.Background(), strings.NewReader(input), Limits{}, func(e SSEEvent) error { got = append(got, e); return nil })
		if err == nil || len(got) != 0 {
			t.Fatalf("expected terminal error without partial output: %q %#v", input, got)
		}
	}
}

type callbackGatedReader struct {
	ctx      context.Context
	released <-chan struct{}
	first    bool
}

func (r *callbackGatedReader) Read(p []byte) (int, error) {
	if !r.first {
		r.first = true
		return copy(p, "data: live\n\n"), nil
	}
	select {
	case <-r.released:
		return 0, io.EOF
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	}
}

func TestParseSSEDispatchesBeforeEOF(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	released := make(chan struct{})
	err := ParseSSE(ctx, &callbackGatedReader{ctx: ctx, released: released}, Limits{}, func(e SSEEvent) error {
		if e.Data != "live" {
			t.Fatalf("got %q", e.Data)
		}
		close(released)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestParseSSEBounds(t *testing.T) {
	tests := []struct {
		name, input string
		limits      Limits
	}{
		{"line", "data: 12345\n\n", Limits{MaxLineBytes: 5, MaxEventBytes: 100, MaxTotalBytes: 100, MaxEvents: 10}},
		{"event", "data: 12345\n\n", Limits{MaxLineBytes: 100, MaxEventBytes: 4, MaxTotalBytes: 100, MaxEvents: 10}},
		{"total", "data: 12345\n\n", Limits{MaxLineBytes: 100, MaxEventBytes: 100, MaxTotalBytes: 8, MaxEvents: 10}},
		{"count", "data: a\n\ndata: b\n\n", Limits{MaxLineBytes: 100, MaxEventBytes: 100, MaxTotalBytes: 100, MaxEvents: 1}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got int
			err := ParseSSE(context.Background(), strings.NewReader(tc.input), tc.limits, func(SSEEvent) error { got++; return nil })
			if err == nil {
				t.Fatal("expected bound error")
			}
			if tc.name != "count" && got != 0 {
				t.Fatalf("partial output: %d", got)
			}
		})
	}
}

type errorReader struct{ done bool }

func (r *errorReader) Read(p []byte) (int, error) {
	if !r.done {
		r.done = true
		copy(p, "data: x\n")
		return len("data: x\n"), nil
	}
	return 0, errors.New("raw secret reader error")
}

func TestParseSSECancellationCallbackAndReaderErrors(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := ParseSSE(ctx, strings.NewReader("data:x\n\n"), Limits{}, func(SSEEvent) error { return nil }); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
	want := errors.New("stop")
	if err := ParseSSE(context.Background(), strings.NewReader("data:x\n\n"), Limits{}, func(SSEEvent) error { return want }); !errors.Is(err, want) {
		t.Fatalf("got %v", err)
	}
	var got int
	err := ParseSSE(context.Background(), &errorReader{}, Limits{}, func(SSEEvent) error { got++; return nil })
	if err == nil || strings.Contains(err.Error(), "secret") || got != 0 {
		t.Fatalf("unsafe/partial result: %v %d", err, got)
	}
}

type blockingReadCloser struct{ closed chan struct{} }

func (r *blockingReadCloser) Read([]byte) (int, error) { <-r.closed; return 0, errors.New("closed") }
func (r *blockingReadCloser) Close() error {
	select {
	case <-r.closed:
	default:
		close(r.closed)
	}
	return nil
}

func TestParseSSECancellationClosesReader(t *testing.T) {
	r := &blockingReadCloser{closed: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- ParseSSE(ctx, r, Limits{}, func(SSEEvent) error { return nil }) }()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not unblock reader")
	}
}

func TestParseSSEPersistsIDAndDefaultsEventType(t *testing.T) {
	input := "id: first\n\ndata: one\n\nid: bad\x00id\ndata: two\n\n"
	var got []SSEEvent
	if err := ParseSSE(context.Background(), strings.NewReader(input), Limits{}, func(e SSEEvent) error { got = append(got, e); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "first" || got[1].ID != "first" || got[0].Event != "message" || got[1].Event != "message" {
		t.Fatalf("unexpected %#v", got)
	}
}

type zeroProgressReader struct{ calls int }

func (r *zeroProgressReader) Read([]byte) (int, error) { r.calls++; return 0, nil }
func TestParseSSEStopsZeroProgressReader(t *testing.T) {
	r := &zeroProgressReader{}
	err := ParseSSE(context.Background(), r, Limits{}, func(SSEEvent) error { return nil })
	if !errors.Is(err, io.ErrNoProgress) {
		t.Fatalf("got %v", err)
	}
	if r.calls > 128 {
		t.Fatalf("unbounded reads: %d", r.calls)
	}
}

func TestParseSSENilReaderIsSafe(t *testing.T) {
	err := ParseSSE(context.Background(), nil, Limits{}, func(SSEEvent) error { return nil })
	var safe *SafeError
	if !errors.As(err, &safe) || safe.Code != "invalid_reader" {
		t.Fatalf("got %v", err)
	}
}

type completionCancelReader struct {
	ctx    context.Context
	cancel context.CancelFunc
	closes atomic.Int32
	done   bool
}

func (r *completionCancelReader) Read(p []byte) (int, error) {
	if !r.done {
		r.done = true
		return copy(p, "data: x\n\n"), nil
	}
	r.cancel()
	return 0, io.EOF
}
func (r *completionCancelReader) Close() error { r.closes.Add(1); return nil }
func TestParseSSEJoinsCancellationWatcher(t *testing.T) {
	for i := 0; i < 100; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		r := &completionCancelReader{ctx: ctx, cancel: cancel}
		err := ParseSSE(ctx, r, Limits{}, func(SSEEvent) error { return nil })
		if err != context.Canceled {
			t.Fatalf("iteration %d: %v", i, err)
		}
		before := r.closes.Load()
		runtime.Gosched()
		if r.closes.Load() != before {
			t.Fatal("close occurred after return")
		}
	}
}
