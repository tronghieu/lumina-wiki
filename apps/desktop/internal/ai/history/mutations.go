package history

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"sort"
	"strings"
)

func (store *HistoryStore) SetEnabled(ctx context.Context, enabled bool) error {
	return store.mutate(ctx, func(root *os.Root) error {
		raw, _ := json.Marshal(enabledState{SchemaVersion: CurrentSchemaVersion, Enabled: enabled})
		return store.atomicWrite(root, stateFileName, append(raw, '\n'))
	})
}

func (store *HistoryStore) Append(ctx context.Context, record ConversationRecord) (AppendOutcome, error) {
	if err := record.Validate(); err != nil {
		return "", err
	}
	outcome := AppendStored
	err := store.mutate(ctx, func(root *os.Root) error {
		enabled, err := store.readEnabled(root)
		if err != nil {
			return err
		}
		if !enabled {
			outcome = AppendDisabled
			return nil
		}
		records, missing, err := store.readConversation(root, record.ConversationID)
		if err != nil {
			return err
		}
		if missing {
			records = []ConversationRecord{}
		}
		candidate, _ := encodeRecord(record)
		for _, existing := range records {
			if existing.AttemptID != record.AttemptID {
				continue
			}
			raw, _ := encodeRecord(existing)
			if bytes.Equal(raw, candidate) {
				outcome = AppendIdempotent
				return nil
			}
			return ErrAttemptConflict
		}
		if len(records) >= MaxAttemptsPerConversation {
			return errors.New("history exceeds attempt limit")
		}
		if record.RetryOfAttemptID != "" {
			found := false
			for _, existing := range records {
				if existing.AttemptID == record.RetryOfAttemptID {
					found = true
					break
				}
			}
			if !found {
				return errors.New("history retry target is missing")
			}
		}
		records = append(records, record)
		if err := validateRetryGraph(records); err != nil {
			return err
		}
		raw, err := encodeConversation(records)
		if err != nil {
			return err
		}
		if err := store.checkWorkspaceBudget(root, record.ConversationID, int64(len(raw))); err != nil {
			return err
		}
		return store.atomicWrite(root, record.ConversationID+".jsonl", raw)
	})
	return outcome, err
}

func (store *HistoryStore) Delete(ctx context.Context, conversationID string) (DeleteResult, error) {
	result := DeleteResult{}
	if !validID(conversationID) {
		return result, errors.New("conversation identity is invalid")
	}
	err := store.mutate(ctx, func(root *os.Root) error {
		name := conversationID + ".jsonl"
		info, err := root.Lstat(name)
		if errors.Is(err, fs.ErrNotExist) {
			if store.syncWorkspace(root) != nil {
				return errors.New("history deletion durability failed")
			}
			result.Durable = true
			return nil
		}
		if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("history file must be regular")
		}
		if store.removeRoot(root, name) != nil {
			return errors.New("delete history failed")
		}
		result.Removed = true
		if store.syncWorkspace(root) != nil {
			return errors.New("history deletion durability failed")
		}
		result.Durable = true
		return nil
	})
	return result, err
}

func (store *HistoryStore) DeleteAll(ctx context.Context) (DeleteAllResult, error) {
	result := DeleteAllResult{DeletedIDs: []string{}, DurableDeletedIDs: []string{}, UncertainDeletedIDs: []string{}, RemainingIDs: []string{}}
	err := store.mutate(ctx, func(root *os.Root) error {
		ids, err := conversationIDs(root)
		if err != nil {
			return err
		}
		for index, id := range ids {
			if store.removeRoot(root, id+".jsonl") != nil {
				result.RemainingIDs = append(result.RemainingIDs, ids[index:]...)
				return errors.New("delete history partially failed")
			}
			result.DeletedIDs = append(result.DeletedIDs, id)
			if store.syncWorkspace(root) != nil {
				result.UncertainDeletedIDs = append(result.UncertainDeletedIDs, id)
				result.RemainingIDs = append(result.RemainingIDs, ids[index+1:]...)
				return errors.New("history deletion durability failed")
			}
			result.DurableDeletedIDs = append(result.DurableDeletedIDs, id)
		}
		result.Durable = true
		return nil
	})
	return result, err
}

func conversationIDs(root *os.Root) ([]string, error) {
	directory, err := root.Open(".")
	if err != nil {
		return nil, errors.New("read history failed")
	}
	defer directory.Close()
	entries, err := directory.ReadDir(maxRawEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, errors.New("read history failed")
	}
	if len(entries) > maxRawEntries {
		return nil, errors.New("history exceeds entry limit")
	}
	var ids []string
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".jsonl")
		info, err := entry.Info()
		if !validID(id) || err != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil, errors.New("history file is invalid")
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}

func (store *HistoryStore) checkWorkspaceBudget(root *os.Root, replacing string, replacementSize int64) error {
	ids, err := conversationIDs(root)
	if err != nil {
		return err
	}
	conversations := 0
	total := replacementSize
	for _, id := range ids {
		if id == replacing {
			continue
		}
		info, err := root.Lstat(id + ".jsonl")
		if err != nil {
			return errors.New("inspect history failed")
		}
		conversations++
		total += info.Size()
	}
	if conversations >= MaxConversations || total > MaxWorkspaceBytes {
		return errors.New("history exceeds workspace limit")
	}
	return nil
}
