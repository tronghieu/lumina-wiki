package providers

import (
	"errors"
	"io"
	"sync"
)

type boundedBody struct {
	body      io.ReadCloser
	remaining int64
	cleanup   func()
	once      sync.Once
	overflow  bool
}

func newBoundedBody(body io.ReadCloser, limit int64, cleanup func()) *boundedBody {
	return &boundedBody{body: body, remaining: limit, cleanup: cleanup}
}
func (b *boundedBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.overflow {
		return 0, NewSafeError("response_too_large", "The provider response exceeded its size limit.", nil)
	}
	if b.remaining > 0 {
		if int64(len(p)) > b.remaining {
			p = p[:b.remaining]
		}
		n, err := b.body.Read(p)
		b.remaining -= int64(n)
		if err != nil {
			b.once.Do(b.cleanup)
			if errors.Is(err, io.EOF) {
				return n, io.EOF
			}
			return n, NewSafeError("response_read", "The provider response could not be read.", err)
		}
		return n, err
	}
	var probe [1]byte
	n, err := b.body.Read(probe[:])
	if n > 0 {
		b.overflow = true
		b.once.Do(b.cleanup)
		return 0, NewSafeError("response_too_large", "The provider response exceeded its size limit.", nil)
	}
	if err != nil {
		b.once.Do(b.cleanup)
		if errors.Is(err, io.EOF) {
			return 0, io.EOF
		}
		return 0, NewSafeError("response_read", "The provider response could not be read.", err)
	}
	return 0, err
}
func (b *boundedBody) Close() error {
	err := b.body.Close()
	b.once.Do(b.cleanup)
	if err == nil || errors.Is(err, io.EOF) {
		return err
	}
	return NewSafeError("response_close", "The provider response could not be closed.", err)
}
