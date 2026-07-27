package history

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

const (
	ownedLeaf     = "lumina-wiki-desktop"
	historyLeaf   = "history"
	stateFileName = "state.json"
	lockFileName  = ".history.lock"
)

type HistoryStore struct {
	baseDir           string
	historyDir        string
	workspaceID       string
	workspaceDir      string
	statePath         string
	lockPath          string
	key               string
	renameRoot        func(*os.Root, string, string) error
	removeRoot        func(*os.Root, string) error
	ioHook            func()
	workspaceHook     func()
	desktopOpenHook   func()
	historyOpenHook   func()
	workspaceOpenHook func()
	locksOpenHook     func()
	protectHandle     func(*os.File, os.FileMode) error
	syncWorkspace     func(*os.Root) error
	operations        atomic.Int64
}

func NewHistoryStore(base string, workspaceID workspaceid.WorkspaceID) (*HistoryStore, error) {
	if base == "" || !filepath.IsAbs(base) || !workspaceID.Valid() {
		return nil, errors.New("history location is invalid")
	}
	desktop := filepath.Join(filepath.Clean(base), ownedLeaf)
	history := filepath.Join(desktop, historyLeaf)
	dir := filepath.Join(history, string(workspaceID))
	return &HistoryStore{baseDir: filepath.Clean(base), historyDir: history, workspaceID: string(workspaceID), workspaceDir: dir,
		statePath: filepath.Join(dir, stateFileName), lockPath: filepath.Join(history, "locks", string(workspaceID)+".lock"),
		key: dir, renameRoot: func(root *os.Root, oldName, newName string) error { return root.Rename(oldName, newName) },
		removeRoot: func(root *os.Root, name string) error { return root.Remove(name) },
		ioHook:     func() {}, workspaceHook: func() {}, desktopOpenHook: func() {}, historyOpenHook: func() {}, workspaceOpenHook: func() {},
		locksOpenHook: func() {}, protectHandle: platformProtectHandle,
		syncWorkspace: syncRootDirectory}, nil
}

func (store *HistoryStore) Enabled(ctx context.Context) (bool, error) {
	var enabled bool
	err := store.withLocked(ctx, func(root *os.Root) error {
		var err error
		enabled, err = store.readEnabled(root)
		return err
	})
	return enabled, err
}

func (store *HistoryStore) Load(ctx context.Context, conversationID string) ([]ConversationRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !validID(conversationID) {
		return nil, errors.New("conversation identity is invalid")
	}
	var records []ConversationRecord
	err := store.withLocked(ctx, func(root *os.Root) error {
		loaded, missing, err := store.readConversation(root, conversationID)
		if missing {
			records = []ConversationRecord{}
			return nil
		}
		records = loaded
		return err
	})
	if err != nil {
		return nil, err
	}
	sortAttempts(records)
	return records, nil
}

func (store *HistoryStore) List(ctx context.Context) ([]ConversationMetadata, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var result []ConversationMetadata
	err := store.withLocked(ctx, func(root *os.Root) error {
		directory, err := root.Open(".")
		if err != nil {
			return errors.New("read history failed")
		}
		defer directory.Close()
		entries, err := directory.ReadDir(maxRawEntries + 1)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return errors.New("read history failed")
		}
		if len(entries) > maxRawEntries {
			return errors.New("history exceeds entry limit")
		}
		var total int64
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".jsonl") {
				continue
			}
			id := strings.TrimSuffix(entry.Name(), ".jsonl")
			if !validID(id) {
				return errors.New("history contains an invalid file")
			}
			info, err := entry.Info()
			if err != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
				return errors.New("history file must be regular")
			}
			total += info.Size()
			if total > MaxWorkspaceBytes {
				return errors.New("history exceeds workspace limit")
			}
			records, _, err := store.readConversation(root, id)
			if err != nil || len(records) == 0 {
				return errors.New("history conversation is invalid")
			}
			sortAttempts(records)
			result = append(result, ConversationMetadata{ConversationID: id, CreatedAt: records[0].CreatedAt,
				UpdatedAt: records[len(records)-1].FinishedAt, Attempts: len(records), LatestStatus: records[len(records)-1].Status})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].ConversationID < result[j].ConversationID
		}
		return result[i].CreatedAt.Before(result[j].CreatedAt)
	})
	return result, nil
}

func (store *HistoryStore) conversationPath(id string) string {
	return filepath.Join(store.workspaceDir, id+".jsonl")
}

func (store *HistoryStore) ioCount() int64 { return store.operations.Load() }
