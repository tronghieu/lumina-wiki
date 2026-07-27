package ai

import (
	"errors"
	"sort"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

var errHistoryDeleteOutcomeMismatch = errors.New("history deletion outcome mismatch")

func validateHistoryDeleteOutcome(result history.DeleteResult, operationFailed bool) error {
	if operationFailed != !result.Durable {
		return errHistoryDeleteOutcomeMismatch
	}
	return nil
}

func safeHistoryTime(value time.Time) (time.Time, bool) {
	if value.IsZero() {
		return time.Time{}, false
	}
	if _, err := value.MarshalJSON(); err != nil {
		return time.Time{}, false
	}
	return value.UTC(), true
}

func emptyFailedDeleteAll(source history.DeleteAllResult) bool {
	return !source.Durable && len(source.DeletedIDs) == 0 && len(source.DurableDeletedIDs) == 0 &&
		len(source.UncertainDeletedIDs) == 0 && len(source.RemainingIDs) == 0
}

func validateHistoryDeleteAll(source history.DeleteAllResult) error {
	groups := [][]string{source.DeletedIDs, source.DurableDeletedIDs, source.UncertainDeletedIDs, source.RemainingIDs}
	sets := make([]map[string]struct{}, len(groups))
	for index, group := range groups {
		if len(group) > history.MaxConversations || !sort.StringsAreSorted(group) {
			return errors.New("history deletion bounds")
		}
		sets[index] = make(map[string]struct{}, len(group))
		for _, id := range group {
			if !validFacadeID(id) {
				return errors.New("history deletion identity")
			}
			if _, duplicate := sets[index][id]; duplicate {
				return errors.New("history deletion duplicate")
			}
			sets[index][id] = struct{}{}
		}
	}
	deleted, durable, uncertain, remaining := sets[0], sets[1], sets[2], sets[3]
	if len(deleted) != len(durable)+len(uncertain) {
		return errors.New("history deletion classification")
	}
	for id := range durable {
		if _, ok := deleted[id]; !ok {
			return errors.New("history durable deletion mismatch")
		}
		if _, overlap := uncertain[id]; overlap {
			return errors.New("history deletion overlap")
		}
	}
	for id := range uncertain {
		if _, ok := deleted[id]; !ok {
			return errors.New("history uncertain deletion mismatch")
		}
	}
	for id := range remaining {
		if _, overlap := deleted[id]; overlap {
			return errors.New("history remaining overlap")
		}
	}
	durableTruth := len(uncertain) == 0 && len(remaining) == 0 && len(durable) == len(deleted)
	if source.Durable != durableTruth {
		return errors.New("history deletion durability mismatch")
	}
	return nil
}
