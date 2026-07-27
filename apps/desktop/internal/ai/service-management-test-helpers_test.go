package ai

import (
	"context"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

type managementRuntimeStub struct {
	mu                 sync.Mutex
	calls              int
	tree               workspace.WorkspaceTree
	note               graph.NoteContent
	enabled            bool
	metadata           []history.ConversationMetadata
	records            []history.ConversationRecord
	latest             history.LatestResult
	deleteResult       history.DeleteResult
	deleteAllResult    history.DeleteAllResult
	err                error
	closeCalls         int
	indexStatus        index.IndexStatus
	indexCancelled     bool
	consentSubject     embeddingConsentSubject
	consentClearStatus index.IndexStatus
	consentClearCalls  int
	consentClearErr    error
	consentMutation    chan struct{}
}

func (stub *managementRuntimeStub) called() {
	stub.mu.Lock()
	stub.calls++
	stub.mu.Unlock()
}
func (stub *managementRuntimeStub) WorkspaceTree(context.Context) (workspace.WorkspaceTree, error) {
	stub.called()
	return stub.tree, stub.err
}
func (stub *managementRuntimeStub) ValidateTrustedRoot(context.Context) error {
	stub.called()
	return stub.err
}
func (stub *managementRuntimeStub) ReadWorkspaceNote(context.Context, string) (graph.NoteContent, error) {
	stub.called()
	return stub.note, stub.err
}
func (stub *managementRuntimeStub) HistoryEnabled(context.Context) (bool, error) {
	stub.called()
	return stub.enabled, stub.err
}
func (stub *managementRuntimeStub) SetHistoryEnabled(_ context.Context, enabled bool) error {
	stub.called()
	if stub.err == nil {
		stub.enabled = enabled
	}
	return stub.err
}
func (stub *managementRuntimeStub) ListHistory(context.Context) ([]history.ConversationMetadata, error) {
	stub.called()
	return append([]history.ConversationMetadata(nil), stub.metadata...), stub.err
}
func (stub *managementRuntimeStub) LoadHistory(context.Context, string) ([]history.ConversationRecord, error) {
	stub.called()
	return append([]history.ConversationRecord(nil), stub.records...), stub.err
}
func (stub *managementRuntimeStub) LoadLatestHistory(context.Context) (history.LatestResult, error) {
	stub.called()
	return stub.latest, stub.err
}
func (stub *managementRuntimeStub) DeleteHistory(context.Context, string) (history.DeleteResult, error) {
	stub.called()
	return stub.deleteResult, stub.err
}
func (stub *managementRuntimeStub) DeleteAllHistory(context.Context) (history.DeleteAllResult, error) {
	stub.called()
	return stub.deleteAllResult, stub.err
}
func (stub *managementRuntimeStub) IndexStatus(context.Context, string) (index.IndexStatus, error) {
	stub.called()
	return stub.indexStatus, stub.err
}
func (stub *managementRuntimeStub) BuildIndex(context.Context, string) (index.IndexStatus, error) {
	stub.called()
	return stub.indexStatus, stub.err
}
func (stub *managementRuntimeStub) CancelIndex(context.Context, string) (bool, error) {
	stub.called()
	return stub.indexCancelled, stub.err
}
func (stub *managementRuntimeStub) ClearIndex(context.Context, string) (index.IndexStatus, error) {
	stub.called()
	return stub.indexStatus, stub.err
}
func (stub *managementRuntimeStub) EmbeddingConsentSubject(context.Context, string) (embeddingConsentSubject, error) {
	stub.called()
	return stub.consentSubject, stub.err
}
func (stub *managementRuntimeStub) BeginConsentMutation(context.Context, string) (func(), error) {
	stub.called()
	if stub.err != nil {
		return nil, stub.err
	}
	if stub.consentMutation != nil {
		select {
		case <-stub.consentMutation:
		default:
			close(stub.consentMutation)
		}
	}
	return func() {}, nil
}
func (stub *managementRuntimeStub) ClearIndexForConsent(context.Context, string) (index.IndexStatus, error) {
	stub.called()
	stub.mu.Lock()
	stub.consentClearCalls++
	stub.mu.Unlock()
	return stub.consentClearStatus, stub.consentClearErr
}
func (stub *managementRuntimeStub) Close() error {
	stub.mu.Lock()
	stub.closeCalls++
	stub.mu.Unlock()
	return nil
}
func (stub *managementRuntimeStub) counts() (int, int) {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	return stub.calls, stub.closeCalls
}
