package ai

import (
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

func TestHistoryDeleteAllDTOAcceptsOnlyTruthfulDomainStates(t *testing.T) {
	type outcome struct {
		result history.DeleteAllResult
		failed bool
	}
	valid := map[string]outcome{
		"empty durable":     {result: history.DeleteAllResult{DeletedIDs: []string{}, DurableDeletedIDs: []string{}, UncertainDeletedIDs: []string{}, RemainingIDs: []string{}, Durable: true}},
		"fully durable":     {result: history.DeleteAllResult{DeletedIDs: []string{"a", "b"}, DurableDeletedIDs: []string{"a", "b"}, UncertainDeletedIDs: []string{}, RemainingIDs: []string{}, Durable: true}},
		"uncertain partial": {result: history.DeleteAllResult{DeletedIDs: []string{"a"}, DurableDeletedIDs: []string{}, UncertainDeletedIDs: []string{"a"}, RemainingIDs: []string{"b"}}, failed: true},
		"remaining partial": {result: history.DeleteAllResult{DeletedIDs: []string{"a"}, DurableDeletedIDs: []string{"a"}, UncertainDeletedIDs: []string{}, RemainingIDs: []string{"b"}}, failed: true},
		"empty failure":     {failed: true},
	}
	for name, value := range valid {
		t.Run("valid/"+name, func(t *testing.T) {
			if _, err := historyDeleteAllDTO(value.result, value.failed); err != nil {
				t.Fatalf("err=%v", err)
			}
		})
	}
	invalid := map[string]history.DeleteAllResult{
		"duplicate":                 {DeletedIDs: []string{"a", "a"}, DurableDeletedIDs: []string{"a"}},
		"unsorted":                  {DeletedIDs: []string{"b", "a"}, DurableDeletedIDs: []string{"a", "b"}, Durable: true},
		"durable outside deleted":   {DeletedIDs: []string{"a"}, DurableDeletedIDs: []string{"b"}},
		"uncertain outside deleted": {DeletedIDs: []string{"a"}, UncertainDeletedIDs: []string{"b"}},
		"durable uncertain overlap": {DeletedIDs: []string{"a"}, DurableDeletedIDs: []string{"a"}, UncertainDeletedIDs: []string{"a"}},
		"missing classification":    {DeletedIDs: []string{"a"}},
		"remaining overlap":         {DeletedIDs: []string{"a"}, DurableDeletedIDs: []string{"a"}, RemainingIDs: []string{"a"}},
		"false complete":            {DeletedIDs: []string{"a"}, DurableDeletedIDs: []string{"a"}},
		"true partial":              {DeletedIDs: []string{"a"}, UncertainDeletedIDs: []string{"a"}, Durable: true},
		"false empty":               {DeletedIDs: []string{}, DurableDeletedIDs: []string{}, UncertainDeletedIDs: []string{}, RemainingIDs: []string{}},
		"durable with error":        {DeletedIDs: []string{"a"}, DurableDeletedIDs: []string{"a"}, Durable: true},
		"partial without error":     {DeletedIDs: []string{"a"}, UncertainDeletedIDs: []string{"a"}, RemainingIDs: []string{"b"}},
	}
	for name, source := range invalid {
		t.Run("invalid/"+name, func(t *testing.T) {
			failed := name == "durable with error"
			if _, err := historyDeleteAllDTO(source, failed); err == nil {
				t.Fatalf("accepted %+v", source)
			}
		})
	}
}
