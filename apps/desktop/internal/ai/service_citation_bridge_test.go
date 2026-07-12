package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

const bridgeCitationID = "cit_0123456789abcdef0123456789abcdef"

func TestReadCitationUsesResolveWhileChatRequestIsActive(t *testing.T) {
	runtime := &bridgeRuntime{entered: make(chan struct{}), contextDone: make(chan struct{}), waitForCancel: true,
		note: retrieval.CitationNote{Path: "wiki/concepts/privacy.md", Heading: "Privacy", Content: "Safe note"}}
	service, capability, _ := newBridgeService(t, 7, &onceRuntime{runtime: runtime})
	chatRequest := validBridgeRequest(capability)
	chatDone := make(chan error, 1)
	go func() { _, err := service.Chat(context.Background(), chatRequest); chatDone <- err }()
	receiveBridgeResult(t, runtime.entered)
	note, err := service.ReadCitationNote(context.Background(), CitationReadRequestDTO{
		Session: chatRequest.Session, RequestID: "request", CitationID: bridgeCitationID,
	})
	if err != nil || note != (CitationNoteDTO{Path: "wiki/concepts/privacy.md", Heading: "Privacy", Content: "Safe note"}) {
		t.Fatalf("note=%#v err=%v", note, err)
	}
	_ = service.CancelChat(context.Background(), chatRequest.Session, "request")
	receiveBridgeResult(t, chatDone)
}

func TestReadCitationIsolatedByRuntimeAndSession(t *testing.T) {
	first := &bridgeRuntime{note: retrieval.CitationNote{Path: "wiki/a.md", Heading: "A", Content: "first"}}
	second := &bridgeRuntime{note: retrieval.CitationNote{Path: "wiki/b.md", Heading: "B", Content: "second"}}
	serviceA, capabilityA, _ := newBridgeService(t, 7, &onceRuntime{runtime: first})
	serviceB, capabilityB, _ := newBridgeService(t, 7, &onceRuntime{runtime: second})
	requestA := CitationReadRequestDTO{Session: bridgeReference(capabilityA), RequestID: "request", CitationID: bridgeCitationID}
	requestB := CitationReadRequestDTO{Session: bridgeReference(capabilityB), RequestID: "request", CitationID: bridgeCitationID}
	noteA, errA := serviceA.ReadCitationNote(context.Background(), requestA)
	noteB, errB := serviceB.ReadCitationNote(context.Background(), requestB)
	if errA != nil || errB != nil || noteA.Content != "first" || noteB.Content != "second" {
		t.Fatalf("a=%#v/%v b=%#v/%v", noteA, errA, noteB, errB)
	}
}

func TestReadCitationSanitizesRuntimeAndReturnedPathFailures(t *testing.T) {
	runtime := &bridgeRuntime{readErr: errors.New("secret /private/root")}
	service, capability, _ := newBridgeService(t, 7, &onceRuntime{runtime: runtime})
	request := CitationReadRequestDTO{Session: bridgeReference(capability), RequestID: "request", CitationID: bridgeCitationID}
	if _, err := service.ReadCitationNote(context.Background(), request); !errors.Is(err, ErrCitationUnavailable) || errors.Is(err, runtime.readErr) {
		t.Fatalf("runtime error=%v", err)
	}
	runtime.mu.Lock()
	runtime.readErr = nil
	runtime.note = retrieval.CitationNote{Path: "/private/root/wiki/a.md", Heading: "A", Content: "secret"}
	runtime.mu.Unlock()
	if note, err := service.ReadCitationNote(context.Background(), request); !errors.Is(err, ErrCitationUnavailable) || note != (CitationNoteDTO{}) {
		t.Fatalf("note=%#v err=%v", note, err)
	}
}

func TestReadCitationRejectsCrossWindowBeforeRuntime(t *testing.T) {
	runtime := &bridgeRuntime{}
	service, capability, _ := newBridgeService(t, 8, &onceRuntime{runtime: runtime})
	_, err := service.ReadCitationNote(context.Background(), CitationReadRequestDTO{
		Session: bridgeReference(capability), RequestID: "request", CitationID: bridgeCitationID,
	})
	if !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("err=%v", err)
	}
	_, reads := runtime.counts()
	if reads != 0 {
		t.Fatalf("reads=%d", reads)
	}
}
