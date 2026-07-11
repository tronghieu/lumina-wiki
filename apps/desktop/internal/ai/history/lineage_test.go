package history

import (
	"context"
	"testing"
)

func TestConversationAllowsMultipleRootTurnsWithIndependentRetryLineages(t *testing.T) {
	store := enabledTestStore(t)
	ctx := context.Background()
	firstRoot := validRecord("conversation-a", "turn-one")
	secondRoot := validRecord("conversation-a", "turn-two")
	secondRoot.UserMessage = "What evidence supports it?"
	firstRetry := validRecord("conversation-a", "turn-one-retry")
	firstRetry.RetryOfAttemptID, firstRetry.UserMessage = firstRoot.AttemptID, ""
	secondRetry := validRecord("conversation-a", "turn-two-retry")
	secondRetry.RetryOfAttemptID, secondRetry.UserMessage = secondRoot.AttemptID, ""
	for _, record := range []ConversationRecord{firstRoot, secondRoot, firstRetry, secondRetry} {
		if _, err := store.Append(ctx, record); err != nil {
			t.Fatalf("append %s: %v", record.AttemptID, err)
		}
	}
	records, err := store.Load(ctx, "conversation-a")
	if err != nil || len(records) != 4 {
		t.Fatalf("unexpected multi-turn history: %#v %v", records, err)
	}
	if rootAttemptID(records, firstRetry.AttemptID) != firstRoot.AttemptID ||
		rootAttemptID(records, secondRetry.AttemptID) != secondRoot.AttemptID {
		t.Fatal("retry lineages crossed root turns")
	}
}
