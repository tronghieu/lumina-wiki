package retrieval

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestCitationCloseRevokesInFlightReadBeforeContentReturn(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "needle secret"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	reader, citations, err := NewCitationReader(context.Background(), index, search.Hits, CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	paused, release := make(chan struct{}), make(chan struct{})
	index.corpus.afterRead = func(string, int) { close(paused); <-release }
	type readResult struct {
		note CitationNote
		err  error
	}
	done := make(chan readResult, 1)
	go func() {
		note, err := reader.ReadCitationNote(context.Background(), citations[0].ID)
		done <- readResult{note, err}
	}()
	<-paused
	reader.Close()
	reader.Close()
	close(release)
	result := <-done
	if !errors.Is(result.err, ErrCitationClosed) || result.note.Content != "" {
		t.Fatalf("read returned after close: %#v, %v", result.note, result.err)
	}
	if note, err := reader.ReadCitationNote(context.Background(), citations[0].ID); !errors.Is(err, ErrCitationClosed) || note.Content != "" {
		t.Fatalf("later read = %#v, %v", note, err)
	}
}

func TestCitationConcurrentReadAndCloseIsRaceSafe(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "needle"})
	search, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	reader, citations, err := NewCitationReader(context.Background(), index, search.Hits, CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	errorsSeen := make(chan error, 64)
	var wait sync.WaitGroup
	for i := 0; i < cap(errorsSeen); i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			_, err := reader.ReadCitationNote(context.Background(), citations[0].ID)
			errorsSeen <- err
		}()
	}
	close(start)
	reader.Close()
	reader.Close()
	wait.Wait()
	close(errorsSeen)
	for err := range errorsSeen {
		if err != nil && !errors.Is(err, ErrCitationClosed) {
			t.Fatalf("read error = %v", err)
		}
	}
}
