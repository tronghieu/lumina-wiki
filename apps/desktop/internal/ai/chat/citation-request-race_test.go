package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type gatedRetriever struct {
	delegate RetrievalRunner
	entered  chan struct{}
	release  chan struct{}
}

func (r gatedRetriever) Retrieve(ctx context.Context, question string, options retrieval.SearchOptions) (HybridResult, error) {
	close(r.entered)
	<-r.release
	return r.delegate.Retrieve(ctx, question, options)
}
func (r gatedRetriever) Lexical() *retrieval.Lexical { return r.delegate.Lexical() }

func TestConcurrentSameRequestIsRejectedWithoutRevokingOwnerLease(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	registry := NewCitationLeaseRegistry()
	entered, release := make(chan struct{}), make(chan struct{})
	first := NewOrchestrator(OrchestratorConfig{Retriever: gatedRetriever{delegate: NewHybridRetriever(HybridConfig{Lexical: lexical}), entered: entered, release: release}, Provider: &scriptedProvider{}, Citations: registry})
	runDone := make(chan error, 1)
	var citation CitationDTO
	go func() {
		runDone <- first.Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "first", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(_ context.Context, event Event) error {
			if event.Citation != nil {
				citation = *event.Citation
			}
			return nil
		}))
	}()
	<-entered
	second := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, Citations: registry})
	err := second.Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "second", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(context.Context, Event) error { return nil }))
	if !errors.Is(err, ErrCitationRequestActive) {
		t.Fatalf("second=%v", err)
	}
	close(release)
	if err := <-runDone; err != nil {
		t.Fatal(err)
	}
	if _, err := registry.ReadCitationNote(context.Background(), "request", citation.CitationID); err != nil {
		t.Fatalf("owner lease=%v", err)
	}
}

func TestExternalRevokeInvalidatesActiveGenerationAndPublishedLease(t *testing.T) {
	registry := NewCitationLeaseRegistry()
	run, err := registry.Begin("request")
	if err != nil {
		t.Fatal(err)
	}
	lease, dto := testLease(t, "request")
	if err := run.Replace(lease); err != nil {
		t.Fatal(err)
	}
	registry.Revoke("request")
	if _, err := lease.ReadCitationNote(context.Background(), dto.CitationID); !errors.Is(err, ErrCitationLeaseClosed) {
		t.Fatalf("old lease=%v", err)
	}
	staleLease, _ := testLease(t, "stale")
	if err := run.Replace(staleLease); !errors.Is(err, ErrCitationRequestActive) {
		t.Fatalf("stale replace=%v", err)
	}
	next, err := registry.Begin("request")
	if err != nil {
		t.Fatalf("next begin=%v", err)
	}
	run.Revoke()
	nextLease, nextDTO := testLease(t, "next")
	if err := next.Replace(nextLease); err != nil {
		t.Fatal(err)
	}
	run.End()
	next.End()
	if _, err := registry.ReadCitationNote(context.Background(), "request", nextDTO.CitationID); err != nil {
		t.Fatalf("next lease=%v", err)
	}
}
