package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

func TestValidateHistoryDeleteOutcome(t *testing.T) {
	tests := []struct {
		name   string
		result history.DeleteResult
		failed bool
		valid  bool
	}{
		{"not found success", history.DeleteResult{Durable: true}, false, true},
		{"removed success", history.DeleteResult{Removed: true, Durable: true}, false, true},
		{"pre-remove failure", history.DeleteResult{}, true, true},
		{"post-remove failure", history.DeleteResult{Removed: true}, true, true},
		{"nondurable success", history.DeleteResult{}, false, false},
		{"removed nondurable success", history.DeleteResult{Removed: true}, false, false},
		{"durable error", history.DeleteResult{Durable: true}, true, false},
		{"removed durable error", history.DeleteResult{Removed: true, Durable: true}, true, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateHistoryDeleteOutcome(test.result, test.failed)
			if (err == nil) != test.valid {
				t.Fatalf("result=%+v failed=%v err=%v", test.result, test.failed, err)
			}
		})
	}
}

func TestDeleteHistoryReturnsValidSuccessAndPartialOutcomes(t *testing.T) {
	tests := []struct {
		name   string
		result history.DeleteResult
		err    error
	}{
		{"not found", history.DeleteResult{Durable: true}, nil},
		{"removed", history.DeleteResult{Removed: true, Durable: true}, nil},
		{"pre-remove failure", history.DeleteResult{}, errors.New("backend")},
		{"post-remove cancellation", history.DeleteResult{Removed: true}, context.Canceled},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runtime := &managementRuntimeStub{deleteResult: test.result, err: test.err}
			service, capability, _ := newBridgeService(t, 7, runtime)
			got, err := service.DeleteHistory(context.Background(), HistoryConversationRequestDTO{Session: bridgeReference(capability), ConversationID: "conversation"})
			if got.Removed != test.result.Removed || got.Durable != test.result.Durable {
				t.Fatalf("got=%+v", got)
			}
			if test.err == nil && err != nil {
				t.Fatalf("err=%v", err)
			}
			if errors.Is(test.err, context.Canceled) && !errors.Is(err, context.Canceled) {
				t.Fatalf("cancel err=%v", err)
			}
			if test.err != nil && !errors.Is(test.err, context.Canceled) && !errors.Is(err, ErrHistoryUnavailable) {
				t.Fatalf("backend err=%v", err)
			}
		})
	}
}

func TestDeleteHistoryHidesOutcomeMismatch(t *testing.T) {
	tests := map[string]*managementRuntimeStub{
		"success nondurable": {deleteResult: history.DeleteResult{Removed: true}},
		"error durable":      {deleteResult: history.DeleteResult{Removed: true, Durable: true}, err: context.Canceled},
	}
	for name, runtime := range tests {
		t.Run(name, func(t *testing.T) {
			service, capability, _ := newBridgeService(t, 7, runtime)
			got, err := service.DeleteHistory(context.Background(), HistoryConversationRequestDTO{Session: bridgeReference(capability), ConversationID: "conversation"})
			if !errors.Is(err, ErrHistoryUnavailable) || got != (HistoryDeleteResultDTO{}) {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
}
