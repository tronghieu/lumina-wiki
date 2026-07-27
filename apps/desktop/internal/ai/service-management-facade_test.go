package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

func TestManagementFacadeMapsSafeTreeAndHistoryDTOs(t *testing.T) {
	now := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)
	runtime := &managementRuntimeStub{enabled: true,
		tree:         workspace.WorkspaceTree{Nodes: []workspace.TreeNode{{ID: "node_0123456789abcdef0123456789abcdef", Name: "wiki", Path: "wiki", Kind: "directory", Children: []workspace.TreeNode{{ID: "node_abcdef0123456789abcdef0123456789", Name: "note.md", Path: "wiki/note.md", Kind: "file", Size: 4}}}}, Warnings: []workspace.TreeWarning{}, Truncated: false},
		metadata:     []history.ConversationMetadata{{ConversationID: "conversation", CreatedAt: now, UpdatedAt: now, Attempts: 1, LatestStatus: history.StatusCompleted}},
		records:      []history.ConversationRecord{{SchemaVersion: history.CurrentSchemaVersion, ConversationID: "conversation", AttemptID: "attempt", CreatedAt: now, FinishedAt: now, Status: history.StatusCompleted, UserMessage: "question", AssistantOutput: "answer", Citations: []history.Citation{{ID: "cit_1", Label: "Note"}}, Usage: history.UsageCounts{InputTokens: 2, OutputTokens: 3}}},
		deleteResult: history.DeleteResult{Removed: true, Durable: true}, deleteAllResult: history.DeleteAllResult{DeletedIDs: []string{"conversation"}, DurableDeletedIDs: []string{"conversation"}, UncertainDeletedIDs: []string{}, RemainingIDs: []string{}, Durable: true}}
	service, capability, _ := newBridgeService(t, 7, runtime)
	reference := bridgeReference(capability)
	tree, err := service.WorkspaceTree(context.Background(), reference)
	if err != nil || len(tree.Nodes) != 1 || tree.Nodes[0].Children[0].Path != "wiki/note.md" {
		t.Fatalf("tree=%+v err=%v", tree, err)
	}
	status, err := service.HistoryStatus(context.Background(), reference)
	if err != nil || !status.Enabled {
		t.Fatalf("status=%+v err=%v", status, err)
	}
	status, err = service.SetHistoryEnabled(context.Background(), SetHistoryEnabledRequestDTO{Session: reference, Enabled: false})
	if err != nil || status.Enabled {
		t.Fatalf("set=%+v err=%v", status, err)
	}
	listed, err := service.ListHistory(context.Background(), reference)
	if err != nil || len(listed.Conversations) != 1 {
		t.Fatalf("list=%+v err=%v", listed, err)
	}
	loaded, err := service.LoadHistory(context.Background(), HistoryConversationRequestDTO{Session: reference, ConversationID: "conversation"})
	if err != nil || len(loaded.Records) != 1 || loaded.Records[0].AssistantOutput != "answer" {
		t.Fatalf("load=%+v err=%v", loaded, err)
	}
	deleted, err := service.DeleteHistory(context.Background(), HistoryConversationRequestDTO{Session: reference, ConversationID: "conversation"})
	if err != nil || !deleted.Removed || !deleted.Durable {
		t.Fatalf("delete=%+v err=%v", deleted, err)
	}
	all, err := service.DeleteAllHistory(context.Background(), reference)
	if err != nil || len(all.DeletedIDs) != 1 || !all.Durable {
		t.Fatalf("all=%+v err=%v", all, err)
	}
	for _, value := range []any{tree, listed, loaded, all} {
		raw, marshalErr := json.Marshal(value)
		if marshalErr != nil || strings.Contains(string(raw), "/private/") || containsJSONField(raw, "root") || containsJSONField(raw, "provider") || containsJSONField(raw, "secret") {
			t.Fatalf("unsafe JSON=%s err=%v", raw, marshalErr)
		}
	}
}

func TestManagementFacadeRejectsCapabilityBeforeRuntime(t *testing.T) {
	runtime := &managementRuntimeStub{}
	service, capability, _ := newBridgeService(t, 7, runtime)
	forged := bridgeReference(capability)
	forged.Generation++
	if _, err := service.ListHistory(context.Background(), forged); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("err=%v", err)
	}
	if calls, _ := runtime.counts(); calls != 0 {
		t.Fatalf("runtime calls=%d", calls)
	}
	crossWindow, _, _ := newBridgeService(t, 8, runtime)
	if _, err := crossWindow.WorkspaceTree(context.Background(), bridgeReference(capability)); !errors.Is(err, ErrSessionRejected) {
		t.Fatalf("cross err=%v", err)
	}
	if calls, _ := runtime.counts(); calls != 0 {
		t.Fatalf("cross runtime calls=%d", calls)
	}
}

func TestManagementFacadeSanitizesRuntimeErrorsAndReturnsPartialDeleteAll(t *testing.T) {
	runtime := &managementRuntimeStub{err: errors.New("corrupt /private/workspace/root"), deleteAllResult: history.DeleteAllResult{DeletedIDs: []string{"gone"}, UncertainDeletedIDs: []string{"gone"}, RemainingIDs: []string{"left"}}}
	service, capability, _ := newBridgeService(t, 7, runtime)
	reference := bridgeReference(capability)
	if _, err := service.WorkspaceTree(context.Background(), reference); !errors.Is(err, ErrWorkspaceTreeUnavailable) || strings.Contains(err.Error(), "private") {
		t.Fatalf("tree err=%v", err)
	}
	result, err := service.DeleteAllHistory(context.Background(), reference)
	if !errors.Is(err, ErrHistoryUnavailable) || len(result.DeletedIDs) != 1 || len(result.RemainingIDs) != 1 || strings.Contains(err.Error(), "private") {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}
