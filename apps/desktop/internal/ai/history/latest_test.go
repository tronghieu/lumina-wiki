package history

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

func TestLoadLatestOutcomesAndTieBreak(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	result, err := store.LoadLatest(ctx)
	if err != nil || result.Status != LatestOff {
		t.Fatalf("off=%#v err=%v", result, err)
	}
	if err := store.SetEnabled(ctx, true); err != nil {
		t.Fatal(err)
	}
	result, err = store.LoadLatest(ctx)
	if err != nil || result.Status != LatestEmpty {
		t.Fatalf("empty=%#v err=%v", result, err)
	}
	at := time.Date(2026, 7, 27, 1, 0, 0, 0, time.UTC)
	a := validRecord("conversation-a", "attempt-a")
	a.CreatedAt, a.FinishedAt = at.Add(-time.Minute), at
	b := validRecord("conversation-b", "attempt-b")
	b.CreatedAt, b.FinishedAt = at.Add(-time.Minute), at
	if _, err := store.Append(ctx, a); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Append(ctx, b); err != nil {
		t.Fatal(err)
	}
	result, err = store.LoadLatest(ctx)
	if err != nil || result.Status != LatestLoaded || result.ConversationID != "conversation-b" ||
		len(result.Records) != 1 {
		t.Fatalf("loaded=%#v err=%v", result, err)
	}
}

func TestLoadLatestUsesGreatestFinishedAtAcrossConversation(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	if err := store.SetEnabled(ctx, true); err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 7, 27, 0, 0, 0, 0, time.UTC)
	long := validRecord("conversation-a", "attempt-a")
	long.CreatedAt, long.FinishedAt = base, base.Add(10*time.Hour)
	laterCreated := validRecord("conversation-a", "attempt-b")
	laterCreated.CreatedAt, laterCreated.FinishedAt = base.Add(time.Hour), base.Add(2*time.Hour)
	other := validRecord("conversation-b", "attempt-c")
	other.CreatedAt, other.FinishedAt = base.Add(3*time.Hour), base.Add(9*time.Hour)
	for _, record := range []ConversationRecord{long, laterCreated, other} {
		if _, err := store.Append(ctx, record); err != nil {
			t.Fatal(err)
		}
	}
	result, err := store.LoadLatest(ctx)
	if err != nil || result.Status != LatestLoaded || result.ConversationID != "conversation-a" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestLoadLatestKeepsCorruptUnavailableAndDeletedDistinct(t *testing.T) {
	t.Run("corrupt", func(t *testing.T) {
		store := newTestStore(t)
		if err := store.SetEnabled(context.Background(), true); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(store.conversationPath("conversation-a"), []byte("{bad}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		result, err := store.LoadLatest(context.Background())
		if err != nil || result.Status != LatestCorrupt {
			t.Fatalf("result=%#v err=%v", result, err)
		}
	})
	t.Run("unavailable", func(t *testing.T) {
		store := newTestStore(t)
		if err := store.SetEnabled(context.Background(), true); err != nil {
			t.Fatal(err)
		}
		if err := os.RemoveAll(store.workspaceDir); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(store.workspaceDir, []byte("not a directory"), 0o600); err != nil {
			t.Fatal(err)
		}
		result, err := store.LoadLatest(context.Background())
		if err != nil || result.Status != LatestUnavailable {
			t.Fatalf("result=%#v err=%v", result, err)
		}
	})
	t.Run("deleted retry exhausted", func(t *testing.T) {
		calls := 0
		result := loadLatestWith(
			func() (string, bool, error) { return "conversation-a", false, nil },
			func(string) ([]ConversationRecord, bool, error) {
				calls++
				return nil, true, nil
			},
		)
		if result.Status != LatestDeletedRetryExhausted || calls != latestDeleteRetries {
			t.Fatalf("result=%#v calls=%d", result, calls)
		}
	})
}

func TestLoadLatestUsesOneBackendLock(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	if err := store.SetEnabled(ctx, true); err != nil {
		t.Fatal(err)
	}
	record := validRecord("conversation-a", "attempt-a")
	if _, err := store.Append(ctx, record); err != nil {
		t.Fatal(err)
	}
	before := store.ioCount()
	result, err := store.LoadLatest(ctx)
	if err != nil || result.Status != LatestLoaded {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if delta := store.ioCount() - before; delta != 1 {
		t.Fatalf("backend lock operations=%d, want 1", delta)
	}
}

func TestLoadLatestCancellation(t *testing.T) {
	store := newTestStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := store.LoadLatest(ctx)
	if !errors.Is(err, context.Canceled) || result.Status != LatestUnavailable {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}
