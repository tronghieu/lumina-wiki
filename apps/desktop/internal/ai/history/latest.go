package history

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"strings"
	"time"
)

const latestDeleteRetries = 3

type LatestStatus string

const (
	LatestOff                   LatestStatus = "off"
	LatestEmpty                 LatestStatus = "empty"
	LatestLoaded                LatestStatus = "loaded"
	LatestDeletedRetryExhausted LatestStatus = "deleted_retry_exhausted"
	LatestUnavailable           LatestStatus = "unavailable"
	LatestCorrupt               LatestStatus = "corrupt"
)

type LatestResult struct {
	Status         LatestStatus         `json:"status"`
	ConversationID string               `json:"conversationId,omitempty"`
	Records        []ConversationRecord `json:"records,omitempty"`
}

func (store *HistoryStore) LoadLatest(ctx context.Context) (LatestResult, error) {
	result := LatestResult{Status: LatestUnavailable}
	if store == nil || ctx == nil {
		return result, errors.New("history is unavailable")
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	err := store.withLocked(ctx, func(root *os.Root) error {
		enabled, err := store.readEnabled(root)
		if err != nil {
			result.Status = LatestCorrupt
			return nil
		}
		if !enabled {
			result.Status = LatestOff
			return nil
		}
		result = loadLatestWith(
			func() (string, bool, error) { return selectLatestConversation(root) },
			func(id string) ([]ConversationRecord, bool, error) {
				return store.readConversation(root, id)
			},
		)
		return nil
	})
	if err != nil {
		if ctx.Err() != nil {
			return LatestResult{Status: LatestUnavailable}, ctx.Err()
		}
		return LatestResult{Status: LatestUnavailable}, nil
	}
	return result, nil
}

type latestCandidate struct {
	id        string
	updatedAt time.Time
}

func selectLatestConversation(root *os.Root) (string, bool, error) {
	directory, err := root.Open(".")
	if err != nil {
		return "", false, errLatestUnavailable
	}
	defer directory.Close()
	entries, err := directory.ReadDir(maxRawEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return "", false, errLatestUnavailable
	}
	if len(entries) > maxRawEntries {
		return "", false, errLatestCorrupt
	}
	var selected latestCandidate
	found := false
	var total int64
	conversations := 0
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		conversations++
		if conversations > MaxConversations {
			return "", false, errLatestCorrupt
		}
		id := strings.TrimSuffix(entry.Name(), ".jsonl")
		info, err := entry.Info()
		if !validID(id) || err != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", false, errLatestCorrupt
		}
		total += info.Size()
		if total > MaxWorkspaceBytes {
			return "", false, errLatestCorrupt
		}
		records, missing, err := readLatestConversation(root, id)
		if missing {
			continue
		}
		if err != nil || len(records) == 0 {
			return "", false, errLatestCorrupt
		}
		updatedAt := records[0].FinishedAt
		for _, record := range records[1:] {
			if record.FinishedAt.After(updatedAt) {
				updatedAt = record.FinishedAt
			}
		}
		candidate := latestCandidate{id: id, updatedAt: updatedAt}
		if !found || candidate.updatedAt.After(selected.updatedAt) ||
			(candidate.updatedAt.Equal(selected.updatedAt) && candidate.id > selected.id) {
			selected, found = candidate, true
		}
	}
	return selected.id, !found, nil
}

func readLatestConversation(root *os.Root, id string) ([]ConversationRecord, bool, error) {
	raw, missing, err := readBoundedRoot(root, id+".jsonl", MaxConversationFileBytes)
	if err != nil || missing {
		return nil, missing, err
	}
	return decodeConversationBytes(raw, id)
}

func decodeConversationBytes(raw []byte, id string) ([]ConversationRecord, bool, error) {
	// Reuse the store decoder without acquiring another backend lock.
	if len(raw) == 0 || raw[len(raw)-1] != '\n' {
		return nil, false, errLatestCorrupt
	}
	lines := strings.Split(string(raw[:len(raw)-1]), "\n")
	if len(lines) > MaxAttemptsPerConversation {
		return nil, false, errLatestCorrupt
	}
	records := make([]ConversationRecord, 0, len(lines))
	seen := map[string]struct{}{}
	for _, line := range lines {
		record, err := decodeRecord([]byte(line))
		if err != nil || record.ConversationID != id {
			return nil, false, errLatestCorrupt
		}
		if _, exists := seen[record.AttemptID]; exists {
			return nil, false, errLatestCorrupt
		}
		seen[record.AttemptID] = struct{}{}
		records = append(records, record)
	}
	if err := validateRetryGraph(records); err != nil {
		return nil, false, errLatestCorrupt
	}
	return records, false, nil
}

func loadLatestWith(selectID func() (string, bool, error),
	load func(string) ([]ConversationRecord, bool, error)) LatestResult {
	for range latestDeleteRetries {
		id, empty, err := selectID()
		if errors.Is(err, errLatestCorrupt) {
			return LatestResult{Status: LatestCorrupt}
		}
		if err != nil {
			return LatestResult{Status: LatestUnavailable}
		}
		if empty {
			return LatestResult{Status: LatestEmpty}
		}
		records, missing, err := load(id)
		if missing {
			continue
		}
		if err != nil {
			return LatestResult{Status: LatestCorrupt}
		}
		sortAttempts(records)
		return LatestResult{Status: LatestLoaded, ConversationID: id, Records: records}
	}
	return LatestResult{Status: LatestDeletedRetryExhausted}
}

var (
	errLatestUnavailable = errors.New("history latest is unavailable")
	errLatestCorrupt     = errors.New("history latest is corrupt")
)
