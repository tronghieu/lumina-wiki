package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
)

func TestChatRejectsForgedSessionBeforeSinkOrRuntime(t *testing.T) {
	runtime := &bridgeRuntime{}
	service, capability, streams := newBridgeService(t, 7, runtime)
	request := validBridgeRequest(capability)
	request.Session.SessionID = "sess_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
	if _, err := service.Chat(context.Background(), request); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("err=%v", err)
	}
	runs, _ := runtime.counts()
	if streams.callCount() != 0 || runs != 0 {
		t.Fatalf("sink=%d runs=%d", streams.callCount(), runs)
	}
}

func TestChatSinkFailureFinishesRequestForRetry(t *testing.T) {
	runtime := &bridgeRuntime{}
	service, capability, streams := newBridgeService(t, 7, &onceRuntime{runtime: runtime})
	request := validBridgeRequest(capability)
	streams.err = errors.New("raw window detail")
	if _, err := service.Chat(context.Background(), request); !errors.Is(err, ErrChatUnavailable) || errors.Is(err, streams.err) {
		t.Fatalf("first=%v", err)
	}
	streams.err = nil
	if _, err := service.Chat(context.Background(), request); err != nil {
		t.Fatalf("retry=%v", err)
	}
}

func TestChatRuntimeReplacementCancelsThenClosesAfterRequestFinish(t *testing.T) {
	oldRuntime := &bridgeRuntime{entered: make(chan struct{}), contextDone: make(chan struct{}), waitForCancel: true}
	service, capability, _ := newBridgeService(t, 7, &onceRuntime{runtime: oldRuntime})
	result := make(chan error, 1)
	go func() { _, err := service.Chat(context.Background(), validBridgeRequest(capability)); result <- err }()
	receiveBridgeResult(t, oldRuntime.entered)
	registry := service.sessions.(*session.Registry)
	newRuntime := &bridgeRuntime{}
	if _, err := registry.Activate(7, testWorkspaceID, session.DisplayMetadata{Label: "Replacement"}, &onceRuntime{runtime: newRuntime}); err != nil {
		t.Fatal(err)
	}
	if err := receiveBridgeResult(t, result); !errors.Is(err, ErrChatUnavailable) {
		t.Fatalf("chat=%v", err)
	}
	oldRuntime.mu.Lock()
	closes := oldRuntime.closeCalls
	oldRuntime.mu.Unlock()
	if closes != 1 {
		t.Fatalf("old closes=%d", closes)
	}
}

func TestChatRejectsEveryBoundedFieldBeforeSessionLookup(t *testing.T) {
	runtime := &bridgeRuntime{}
	service, capability, streams := newBridgeService(t, 7, runtime)
	linked := make([]string, retrieval.MaxLinkedPaths+1)
	for index := range linked {
		linked[index] = fmt.Sprintf("wiki/%03d.md", index)
	}
	tests := map[string]func(*ChatRequestDTO){
		"question":     func(request *ChatRequestDTO) { request.Question = strings.Repeat("x", retrieval.MaxQueryBytes+1) },
		"chat profile": func(request *ChatRequestDTO) { request.Profiles.ChatProfileID = "bad/profile" },
		"embedding":    func(request *ChatRequestDTO) { request.Profiles.EmbeddingProfileID = "bad/profile" },
		"linked paths": func(request *ChatRequestDTO) { request.LinkedPaths = linked },
		"session":      func(request *ChatRequestDTO) { request.Session.Generation = 0 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			request := validBridgeRequest(capability)
			mutate(&request)
			if _, err := service.Chat(context.Background(), request); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("err=%v", err)
			}
		})
	}
	runs, _ := runtime.counts()
	if streams.callCount() != 0 || runs != 0 {
		t.Fatalf("sink=%d runs=%d", streams.callCount(), runs)
	}
}

func TestChatCancelledCallContextDoesNotAccessSession(t *testing.T) {
	runtime := &bridgeRuntime{}
	service, capability, streams := newBridgeService(t, 7, runtime)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.Chat(ctx, validBridgeRequest(capability)); !errors.Is(err, ErrWindowUnavailable) {
		t.Fatalf("err=%v", err)
	}
	if streams.callCount() != 0 {
		t.Fatalf("sink=%d", streams.callCount())
	}
}
