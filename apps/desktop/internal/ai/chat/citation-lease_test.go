package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func testLease(t *testing.T, scopeID string) (*CitationLease, CitationDTO) {
	t.Helper()
	index, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	result, _ := index.Search(context.Background(), "needle", retrieval.SearchOptions{})
	allowlist, err := NewEvidenceAllowlist(context.Background(), index, result.Hits, retrieval.CitationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	scope, err := NewEvidenceScope(allowlist, []string{"S1"})
	if err != nil {
		t.Fatal(err)
	}
	dto := scope.citationDTOs()[0]
	lease, err := NewCitationLease(scope, []CitationDTO{dto})
	if err != nil {
		t.Fatal(err)
	}
	_ = scopeID
	return lease, dto
}

func TestCitationLeaseRegistryReadReplaceRevokeAndClose(t *testing.T) {
	registry := NewCitationLeaseRegistry()
	first, firstDTO := testLease(t, "request")
	if err := registry.Replace("request", first); err != nil {
		t.Fatal(err)
	}
	note, err := registry.ReadCitationNote(context.Background(), "request", firstDTO.CitationID)
	if err != nil || note.Content == "" {
		t.Fatalf("note=%#v err=%v", note, err)
	}
	if _, err := registry.ReadCitationNote(context.Background(), "other", firstDTO.CitationID); !errors.Is(err, ErrUnknownCitationLease) {
		t.Fatalf("cross=%v", err)
	}
	second, secondDTO := testLease(t, "replacement")
	if err := registry.Replace("request", second); err != nil {
		t.Fatal(err)
	}
	if _, err := first.ReadCitationNote(context.Background(), firstDTO.CitationID); !errors.Is(err, ErrCitationLeaseClosed) {
		t.Fatalf("old=%v", err)
	}
	registry.Revoke("request")
	if _, err := registry.ReadCitationNote(context.Background(), "request", secondDTO.CitationID); !errors.Is(err, ErrUnknownCitationLease) {
		t.Fatalf("revoked=%v", err)
	}
	third, _ := testLease(t, "third")
	_ = registry.Replace("third", third)
	registry.Close()
	if _, err := third.ReadCitationNote(context.Background(), secondDTO.CitationID); !errors.Is(err, ErrCitationLeaseClosed) {
		t.Fatalf("closed=%v", err)
	}
}

func TestOrchestratorCitationReadableAfterSuccessfulRun(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	registry := NewCitationLeaseRegistry()
	orchestrator := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, Citations: registry})
	var citation CitationDTO
	err := orchestrator.Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(_ context.Context, event Event) error {
		if event.Citation != nil {
			citation = *event.Citation
		}
		return nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	note, err := registry.ReadCitationNote(context.Background(), "request", citation.CitationID)
	if err != nil || note.Content == "" {
		t.Fatalf("note=%#v err=%v", note, err)
	}
}

func TestOrchestratorCitationReadableInsideCitationCallback(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	registry := NewCitationLeaseRegistry()
	read := false
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, Citations: registry}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(ctx context.Context, event Event) error {
		if event.Citation != nil {
			_, readErr := registry.ReadCitationNote(ctx, "request", event.Citation.CitationID)
			read = readErr == nil
		}
		return nil
	}))
	if err != nil || !read {
		t.Fatalf("err=%v read=%v", err, read)
	}
}

func TestOrchestratorLeaseInstallFailureEmitsNoCitation(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	registry := NewCitationLeaseRegistry()
	provider := chatProviderFunc(func(ctx context.Context, _ providers.ChatRequest, sink providers.StreamSink) error {
		if err := sink.OnEvent(ctx, providers.StreamEvent{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "answer [S1]"}}); err != nil {
			return err
		}
		registry.Close()
		return nil
	})
	citations := 0
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: provider, Citations: registry}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "attempt", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(_ context.Context, event Event) error {
		if event.Kind == EventCitation {
			citations++
		}
		return nil
	}))
	if err == nil || citations != 0 {
		t.Fatalf("err=%v citations=%d", err, citations)
	}
}

func TestCitationLeaseConcurrentReadAndRevoke(t *testing.T) {
	reader := &blockingCitationReader{started: make(chan struct{}), release: make(chan struct{})}
	dto := CitationDTO{ModelID: "S1", CitationID: "cit_00000000000000000000000000000000", Path: "wiki/a.md"}
	allowlist := &EvidenceAllowlist{reader: reader, entries: []evidenceEntry{{ModelID: dto.ModelID, CitationID: dto.CitationID}}, byID: map[string]evidenceEntry{dto.ModelID: {ModelID: dto.ModelID, CitationID: dto.CitationID}}}
	scope := &EvidenceScope{allowlist: allowlist, allowed: map[string]bool{"S1": true}}
	lease, _ := NewCitationLease(scope, []CitationDTO{dto})
	registry := NewCitationLeaseRegistry()
	_ = registry.Replace("request", lease)
	readDone := make(chan error, 1)
	go func() {
		_, err := registry.ReadCitationNote(context.Background(), "request", dto.CitationID)
		readDone <- err
	}()
	<-reader.started
	registry.Revoke("request")
	close(reader.release)
	if err := <-readDone; !errors.Is(err, ErrCitationLeaseClosed) {
		t.Fatalf("read=%v", err)
	}
}

func seedRequestCitation(t *testing.T, registry *CitationLeaseRegistry, lexical *retrieval.Lexical) CitationDTO {
	t.Helper()
	var citation CitationDTO
	err := NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: &scriptedProvider{}, Citations: registry}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "first", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(_ context.Context, event Event) error {
		if event.Citation != nil {
			citation = *event.Citation
		}
		return nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	return citation
}

func TestOrchestratorRequestReuseRevokesPriorCitationOnEveryOutcome(t *testing.T) {
	lexical, _ := testIndex(t, map[string]string{"wiki/a.md": "needle evidence"})
	noCitation := chatProviderFunc(func(ctx context.Context, _ providers.ChatRequest, sink providers.StreamSink) error {
		return sink.OnEvent(ctx, providers.StreamEvent{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "answer without citation"}})
	})
	tests := []struct {
		name string
		run  func(*CitationLeaseRegistry) error
	}{
		{"success_no_citation", func(registry *CitationLeaseRegistry) error {
			return NewOrchestrator(OrchestratorConfig{Retriever: NewHybridRetriever(HybridConfig{Lexical: lexical}), Provider: noCitation, Citations: registry}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "second", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(context.Context, Event) error { return nil }))
		}},
		{"prestream_failure", func(registry *CitationLeaseRegistry) error {
			return NewOrchestrator(OrchestratorConfig{Retriever: fixedRetriever{lexical: lexical, err: retrieval.ErrStaleIndex}, Provider: noCitation, Citations: registry}).Run(context.Background(), Request{RequestID: "request", ConversationID: "conv", AttemptID: "second", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(context.Context, Event) error { return nil }))
		}},
		{"cancellation", func(registry *CitationLeaseRegistry) error {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
			defer cancel()
			return NewOrchestrator(OrchestratorConfig{Retriever: contextBlockingRetriever{lexical: lexical}, Provider: noCitation, Citations: registry}).Run(ctx, Request{RequestID: "request", ConversationID: "conv", AttemptID: "second", Question: "needle", Profile: chatProfile()}, eventSinkFunc(func(context.Context, Event) error { return nil }))
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			registry := NewCitationLeaseRegistry()
			citation := seedRequestCitation(t, registry, lexical)
			_ = tc.run(registry)
			if _, err := registry.ReadCitationNote(context.Background(), "request", citation.CitationID); !errors.Is(err, ErrUnknownCitationLease) {
				t.Fatalf("stale=%v", err)
			}
		})
	}
}
