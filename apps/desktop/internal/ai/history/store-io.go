package history

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"strings"
)

const (
	maxRawEntries       = MaxConversations + 96
	maxTempCleanupCount = 64
	maxTempCleanupBytes = 4 * 1024 * 1024
)

type enabledState struct {
	SchemaVersion int  `json:"schemaVersion"`
	Enabled       bool `json:"enabled"`
}

func (store *HistoryStore) readEnabled(root *os.Root) (bool, error) {
	raw, missing, err := readBoundedRoot(root, stateFileName, 1024)
	if err != nil || missing {
		return false, err
	}
	if rejectDuplicateKeys(raw) != nil {
		return false, errors.New("history state is malformed")
	}
	var state enabledState
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&state) != nil || requireJSONEnd(decoder) != nil || state.SchemaVersion != CurrentSchemaVersion {
		return false, errors.New("history state is malformed")
	}
	return state.Enabled, nil
}

func (store *HistoryStore) readConversation(root *os.Root, id string) ([]ConversationRecord, bool, error) {
	raw, missing, err := readBoundedRoot(root, id+".jsonl", MaxConversationFileBytes)
	if err != nil || missing {
		return nil, missing, err
	}
	if len(raw) == 0 || raw[len(raw)-1] != '\n' {
		return nil, false, errors.New("history conversation is malformed")
	}
	lines := bytes.Split(raw[:len(raw)-1], []byte{'\n'})
	if len(lines) > MaxAttemptsPerConversation {
		return nil, false, errors.New("history exceeds attempt limit")
	}
	records := make([]ConversationRecord, 0, len(lines))
	seen := map[string]struct{}{}
	for _, line := range lines {
		record, err := decodeRecord(line)
		if err != nil || record.ConversationID != id {
			return nil, false, errors.New("history conversation is invalid")
		}
		if _, exists := seen[record.AttemptID]; exists {
			return nil, false, errors.New("history contains duplicate attempt")
		}
		seen[record.AttemptID] = struct{}{}
		records = append(records, record)
	}
	if err := validateRetryGraph(records); err != nil {
		return nil, false, err
	}
	return records, false, nil
}

func readBoundedRoot(root *os.Root, name string, limit int) ([]byte, bool, error) {
	info, err := root.Lstat(name)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, true, nil
	}
	if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, false, errors.New("history file is invalid")
	}
	if !privateFileMode(info) || info.Size() > int64(limit) {
		return nil, false, errors.New("history file is unsafe")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, false, errors.New("open history failed")
	}
	defer file.Close()
	if platformEnsureProtectedHandle(file) != nil {
		return nil, false, errors.New("protect history file failed")
	}
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, false, errors.New("history changed while opening")
	}
	raw, err := io.ReadAll(&io.LimitedReader{R: file, N: int64(limit + 1)})
	if err != nil || len(raw) > limit {
		return nil, false, errors.New("read history failed")
	}
	return raw, false, nil
}

func (store *HistoryStore) cleanupTemps(root *os.Root) error {
	directory, err := root.Open(".")
	if err != nil {
		return errors.New("open history directory failed")
	}
	defer directory.Close()
	entries, err := directory.ReadDir(maxRawEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return errors.New("scan history maintenance failed")
	}
	if len(entries) > maxRawEntries {
		return errors.New("history maintenance required")
	}
	count := 0
	var total int64
	for _, entry := range entries {
		if !isTempName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil || entry.Type()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("history temporary file is invalid")
		}
		count++
		total += info.Size()
		if count > maxTempCleanupCount || total > maxTempCleanupBytes {
			return errors.New("history maintenance required")
		}
		if root.Remove(entry.Name()) != nil {
			return errors.New("history maintenance failed")
		}
	}
	return nil
}

func encodeConversation(records []ConversationRecord) ([]byte, error) {
	var output strings.Builder
	for _, record := range records {
		raw, err := encodeRecord(record)
		if err != nil {
			return nil, err
		}
		output.Write(raw)
		output.WriteByte('\n')
		if output.Len() > MaxConversationFileBytes {
			return nil, errors.New("history exceeds conversation size limit")
		}
	}
	return []byte(output.String()), nil
}
