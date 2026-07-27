package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

func TestDeleteAllHistoryPreservesPreMutationFailureWithEmptyDTO(t *testing.T) {
	for name, backendErr := range map[string]error{
		"canceled": context.Canceled,
		"backend":  errors.New("private backend failure"),
	} {
		t.Run(name, func(t *testing.T) {
			runtime := &managementRuntimeStub{err: backendErr}
			service, capability, _ := newBridgeService(t, 7, runtime)
			result, err := service.DeleteAllHistory(context.Background(), bridgeReference(capability))
			wantErr := ErrHistoryUnavailable
			if errors.Is(backendErr, context.Canceled) {
				wantErr = context.Canceled
			}
			if !errors.Is(err, wantErr) {
				t.Fatalf("err=%v", err)
			}
			if result.Durable || len(result.DeletedIDs) != 0 || len(result.DurableDeletedIDs) != 0 || len(result.UncertainDeletedIDs) != 0 || len(result.RemainingIDs) != 0 {
				t.Fatalf("result=%+v", result)
			}
			if result.DeletedIDs == nil || result.DurableDeletedIDs == nil || result.UncertainDeletedIDs == nil || result.RemainingIDs == nil {
				t.Fatalf("nil empty arrays=%+v", result)
			}
		})
	}
}

func TestDeleteAllHistoryRejectsContradictoryFailureDataWithoutMaskingContext(t *testing.T) {
	runtime := &managementRuntimeStub{err: context.Canceled,
		deleteAllResult: history.DeleteAllResult{DeletedIDs: []string{"gone"}, RemainingIDs: []string{"gone"}}}
	service, capability, _ := newBridgeService(t, 7, runtime)
	result, err := service.DeleteAllHistory(context.Background(), bridgeReference(capability))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
	if result.DeletedIDs != nil || result.RemainingIDs != nil {
		t.Fatalf("contradictory result exposed=%+v", result)
	}
}

func TestDeleteAllHistoryHidesOutcomeMismatch(t *testing.T) {
	tests := map[string]*managementRuntimeStub{
		"durable with error": {err: context.Canceled, deleteAllResult: history.DeleteAllResult{
			DeletedIDs: []string{"gone"}, DurableDeletedIDs: []string{"gone"}, Durable: true}},
		"partial without error": {deleteAllResult: history.DeleteAllResult{
			DeletedIDs: []string{"gone"}, UncertainDeletedIDs: []string{"gone"}, RemainingIDs: []string{"left"}}},
	}
	for name, runtime := range tests {
		t.Run(name, func(t *testing.T) {
			service, capability, _ := newBridgeService(t, 7, runtime)
			result, err := service.DeleteAllHistory(context.Background(), bridgeReference(capability))
			if !errors.Is(err, ErrHistoryUnavailable) {
				t.Fatalf("err=%v", err)
			}
			if result.DeletedIDs != nil || result.DurableDeletedIDs != nil || result.UncertainDeletedIDs != nil || result.RemainingIDs != nil || result.Durable {
				t.Fatalf("mismatch exposed=%+v", result)
			}
		})
	}
}
