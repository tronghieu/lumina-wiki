package chat

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type blockingCitationReader struct {
	started, release chan struct{}
	mu               sync.Mutex
	closed           bool
}

func (reader *blockingCitationReader) ReadCitationNote(context.Context, string) (retrieval.CitationNote, error) {
	close(reader.started)
	<-reader.release
	reader.mu.Lock()
	defer reader.mu.Unlock()
	if reader.closed {
		return retrieval.CitationNote{}, retrieval.ErrCitationClosed
	}
	return retrieval.CitationNote{Content: "must not return"}, nil
}

func (reader *blockingCitationReader) Close() {
	reader.mu.Lock()
	reader.closed = true
	reader.mu.Unlock()
}

func TestAllowlistCloseRevokesInFlightRead(t *testing.T) {
	reader := &blockingCitationReader{started: make(chan struct{}), release: make(chan struct{})}
	allowlist := &EvidenceAllowlist{reader: reader, byID: map[string]evidenceEntry{}, entries: []evidenceEntry{}}
	readDone := make(chan error, 1)
	go func() {
		_, err := allowlist.ReadCitationNote(context.Background(), "cit_00000000000000000000000000000000")
		readDone <- err
	}()
	<-reader.started
	closeDone := make(chan struct{})
	go func() { allowlist.Close(); close(closeDone) }()
	select {
	case <-closeDone:
	case <-time.After(time.Second):
		close(reader.release)
		t.Fatal("Close blocked behind an in-flight read")
	}
	close(reader.release)
	if err := <-readDone; !errors.Is(err, retrieval.ErrCitationClosed) {
		t.Fatalf("in-flight read = %v", err)
	}
}
