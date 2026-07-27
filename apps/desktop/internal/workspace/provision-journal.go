package workspace

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"sort"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/contract"
)

const (
	provisionJournalPrefix = ".lumina-provision-"
	maxJournalBytes        = 4 * 1024 * 1024
)

type journalFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int    `json:"size"`
}

type provisionJournal struct {
	ContractDigest string        `json:"contractDigest"`
	Directories    []string      `json:"directories"`
	Files          []journalFile `json:"files"`
	RecoveryID     string        `json:"recoveryId"`
	Version        int           `json:"version"`
}

func buildJournal(record pendingRecord, materialized contract.Materialized) provisionJournal {
	files := materialized.Files()
	journalFiles := make([]journalFile, len(files))
	for i, file := range files {
		journalFiles[i] = journalFile{
			Path: file.Path, SHA256: file.SHA256, Size: len(file.Bytes()),
		}
	}
	return provisionJournal{
		Version:        1,
		RecoveryID:     record.RecoveryID,
		ContractDigest: record.ContractDigest,
		Directories:    materialized.Directories(),
		Files:          journalFiles,
	}
}

func encodeJournal(journal provisionJournal) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(journal); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func decodeJournal(raw []byte) (provisionJournal, error) {
	var journal provisionJournal
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&journal); err != nil {
		return provisionJournal{}, ErrPublication
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return provisionJournal{}, ErrPublication
	}
	if journal.Version != 1 || !validRecoveryID(journal.RecoveryID) ||
		journal.ContractDigest == "" || len(journal.Files) == 0 {
		return provisionJournal{}, ErrPublication
	}
	if !sort.StringsAreSorted(journal.Directories) {
		return provisionJournal{}, ErrPublication
	}
	previous := ""
	for _, file := range journal.Files {
		if file.Path == "" || file.Path <= previous || file.Size < 0 || len(file.SHA256) != 64 {
			return provisionJournal{}, ErrPublication
		}
		previous = file.Path
	}
	return journal, nil
}

func journalsEqual(first, second provisionJournal) bool {
	left, leftErr := encodeJournal(first)
	right, rightErr := encodeJournal(second)
	return leftErr == nil && rightErr == nil && bytes.Equal(left, right)
}
