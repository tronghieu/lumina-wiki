package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

type blockingManagementRuntime struct {
	*managementRuntimeStub
	entered chan struct{}
	release chan struct{}
}

func (runtime *blockingManagementRuntime) ListHistory(ctx context.Context) ([]history.ConversationMetadata, error) {
	runtime.called()
	close(runtime.entered)
	select {
	case <-runtime.release:
		return []history.ConversationMetadata{}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type combinedRuntime struct {
	*bridgeRuntime
	*blockingManagementRuntime
}

func (runtime *combinedRuntime) Close() error { return runtime.bridgeRuntime.Close() }

func (runtime *combinedRuntime) closeCount() int {
	runtime.bridgeRuntime.mu.Lock()
	defer runtime.bridgeRuntime.mu.Unlock()
	return runtime.bridgeRuntime.closeCalls
}

func TestManagementFacadeCancellationAndTypedNilRuntime(t *testing.T) {
	runtime := &managementRuntimeStub{}
	service, capability, _ := newBridgeService(t, 7, runtime)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.ListHistory(ctx, bridgeReference(capability)); !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
	if calls, _ := runtime.counts(); calls != 0 {
		t.Fatalf("runtime calls=%d", calls)
	}
	var typedNil *managementRuntimeStub
	typedService, typedCapability, _ := newBridgeService(t, 7, &onceRuntime{runtime: typedNil})
	if _, err := typedService.HistoryStatus(context.Background(), bridgeReference(typedCapability)); !errors.Is(err, ErrHistoryUnavailable) {
		t.Fatalf("typed nil err=%v", err)
	}
}

func TestManagementFacadeRejectsCorruptOrOversizedDomainOutput(t *testing.T) {
	runtime := &managementRuntimeStub{tree: workspace.WorkspaceTree{Nodes: []workspace.TreeNode{{ID: "node_0123456789abcdef0123456789abcdef", Name: "root", Path: "/private/root", Kind: "directory"}}}}
	service, capability, _ := newBridgeService(t, 7, runtime)
	reference := bridgeReference(capability)
	if _, err := service.WorkspaceTree(context.Background(), reference); !errors.Is(err, ErrWorkspaceTreeUnavailable) {
		t.Fatalf("tree err=%v", err)
	}
	runtime.tree = workspace.WorkspaceTree{}
	runtime.metadata = make([]history.ConversationMetadata, history.MaxConversations+1)
	if _, err := service.ListHistory(context.Background(), reference); !errors.Is(err, ErrHistoryUnavailable) {
		t.Fatalf("history err=%v", err)
	}
}

func TestChatAndManagementLeasesPinRuntimeThroughDeactivate(t *testing.T) {
	chatRuntime := &bridgeRuntime{entered: make(chan struct{}), contextDone: make(chan struct{}), waitForCancel: true}
	management := &blockingManagementRuntime{managementRuntimeStub: &managementRuntimeStub{}, entered: make(chan struct{}), release: make(chan struct{})}
	runtime := &combinedRuntime{bridgeRuntime: chatRuntime, blockingManagementRuntime: management}
	service, capability, _ := newBridgeService(t, 7, runtime)
	chatDone := make(chan error, 1)
	go func() { _, err := service.Chat(context.Background(), validBridgeRequest(capability)); chatDone <- err }()
	<-chatRuntime.entered
	historyDone := make(chan error, 1)
	go func() {
		_, err := service.ListHistory(context.Background(), bridgeReference(capability))
		historyDone <- err
	}()
	<-management.entered
	if err := service.DeactivateWorkspace(context.Background(), bridgeReference(capability)); err != nil {
		t.Fatal(err)
	}
	if closes := runtime.closeCount(); closes != 0 {
		t.Fatalf("premature closes=%d", closes)
	}
	select {
	case <-chatRuntime.contextDone:
	case <-time.After(time.Second):
		t.Fatal("chat was not canceled")
	}
	if err := <-chatDone; !errors.Is(err, ErrChatUnavailable) {
		t.Fatalf("chat err=%v", err)
	}
	if closes := runtime.closeCount(); closes != 0 {
		t.Fatalf("closed while history pinned=%d", closes)
	}
	close(management.release)
	if err := <-historyDone; err != nil {
		t.Fatalf("history err=%v", err)
	}
	if closes := runtime.closeCount(); closes != 1 {
		t.Fatalf("final closes=%d", closes)
	}
}

var _ managementCapableRuntime = (*combinedRuntime)(nil)
