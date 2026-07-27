package ai

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

func TestLoadedRuntimeCloseCancelsActiveChatAndIsIdempotent(t *testing.T) {
	provider := &runtimeBlockingProvider{entered: make(chan struct{})}
	runtime := newRuntimeForTest(t, runtimeWorkspace(t), &runtimeConfigSpy{config: runtimeConfig("chat-main", "")}, &runtimeHistorySpy{}, provider)
	capture := &runtimeEventCapture{}
	runDone := make(chan error, 1)
	go func() {
		runDone <- runtime.RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "question",
			Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"}}, capture)
	}()
	select {
	case <-provider.entered:
	case <-time.After(time.Second):
		t.Fatal("provider stream did not start")
	}
	closeDone := make(chan error, 2)
	go func() { closeDone <- runtime.Close() }()
	go func() { closeDone <- runtime.Close() }()
	for range 2 {
		if err := <-closeDone; err != nil {
			t.Fatal(err)
		}
	}
	if err := <-runDone; err == nil {
		t.Fatal("cancelled chat returned success")
	}
	if len(capture.events) != 2 || capture.events[0].Kind != chat.EventStarted || capture.events[1].Kind != chat.EventCancelled {
		t.Fatalf("cancel events = %#v", capture.events)
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if !runtime.closed || runtime.root != "" || runtime.proof != nil {
		t.Fatalf("private runtime state retained after close")
	}
}

func TestLoadedRuntimeConcurrentCitationReadsAndCloseDoNotPanic(t *testing.T) {
	provider := &runtimeProviderSpy{events: []providers.StreamEvent{{Kind: providers.EventDelta, Delta: &providers.Delta{Text: "done"}}}}
	runtime := newRuntimeForTest(t, runtimeWorkspace(t), &runtimeConfigSpy{config: runtimeConfig("chat-main", "")}, &runtimeHistorySpy{}, provider)
	if err := runtime.RunChat(context.Background(), runtimeChatRequest{RequestID: "request", ConversationID: "conversation", Question: "question",
		Profiles: ProfileSelectionDTO{ChatProfileID: "chat-main"}}, &runtimeEventCapture{}); err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for range 50 {
		group.Add(1)
		go func() {
			defer group.Done()
			_, _ = runtime.ReadCitationNote(context.Background(), "request", "cit_00000000000000000000000000000000")
		}()
	}
	group.Add(1)
	go func() { defer group.Done(); _ = runtime.Close() }()
	group.Wait()
}

type runtimeBlockingProvider struct {
	once    sync.Once
	entered chan struct{}
}

func (provider *runtimeBlockingProvider) Stream(ctx context.Context, _ providers.ChatRequest, _ providers.StreamSink) error {
	provider.once.Do(func() { close(provider.entered) })
	<-ctx.Done()
	return ctx.Err()
}
