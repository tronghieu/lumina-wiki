package ai

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
)

func TestHistoryDTORejectsNonJSONTimesAndNormalizesUTC(t *testing.T) {
	valid := time.Date(2026, 7, 12, 1, 2, 3, 0, time.FixedZone("valid", 7*60*60))
	metadata, err := historyListDTO([]history.ConversationMetadata{{ConversationID: "conversation", CreatedAt: valid, UpdatedAt: valid, Attempts: 1, LatestStatus: history.StatusCompleted}})
	if err != nil || metadata.Conversations[0].CreatedAt.Location() != time.UTC {
		t.Fatalf("metadata=%+v err=%v", metadata, err)
	}
	record := completedRecord("conversation", "attempt", "question", "answer", valid)
	records, err := historyRecordsDTO([]history.ConversationRecord{record}, "conversation")
	if err != nil || records.Records[0].CreatedAt.Location() != time.UTC {
		t.Fatalf("records=%+v err=%v", records, err)
	}
	if _, err := json.Marshal(metadata); err != nil {
		t.Fatalf("metadata JSON=%v", err)
	}
	if _, err := json.Marshal(records); err != nil {
		t.Fatalf("records JSON=%v", err)
	}

	invalid := []time.Time{
		time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 1, 1, 0, 0, 0, 0, time.FixedZone("invalid", 25*60*60)),
	}
	for _, value := range invalid {
		t.Run(value.String(), func(t *testing.T) {
			if _, err := historyListDTO([]history.ConversationMetadata{{ConversationID: "conversation", CreatedAt: value, UpdatedAt: value, Attempts: 1, LatestStatus: history.StatusCompleted}}); err == nil {
				t.Fatal("metadata accepted invalid time")
			}
			record := completedRecord("conversation", "attempt", "question", "answer", value)
			if _, err := historyRecordsDTO([]history.ConversationRecord{record}, "conversation"); err == nil {
				t.Fatal("record accepted invalid time")
			}
		})
	}
}
