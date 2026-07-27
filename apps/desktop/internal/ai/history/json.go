package history

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

func encodeRecord(record ConversationRecord) ([]byte, error) {
	if err := record.Validate(); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(record)
	if err != nil || len(raw) > MaxRecordBytes {
		return nil, errors.New("history record exceeds size limit")
	}
	return raw, nil
}

func decodeRecord(raw []byte) (ConversationRecord, error) {
	if len(raw) > MaxRecordBytes {
		return ConversationRecord{}, errors.New("history record exceeds size limit")
	}
	if err := rejectDuplicateKeys(raw); err != nil {
		return ConversationRecord{}, errors.New("history record is malformed")
	}
	var record ConversationRecord
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&record); err != nil {
		return ConversationRecord{}, errors.New("history record is malformed")
	}
	if err := requireJSONEnd(decoder); err != nil {
		return ConversationRecord{}, err
	}
	if err := record.Validate(); err != nil {
		return ConversationRecord{}, err
	}
	return record, nil
}

func rejectDuplicateKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := scanJSON(decoder); err != nil {
		return err
	}
	_, err := decoder.Token()
	if !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}

func scanJSON(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	if delim == '[' {
		for decoder.More() {
			if err := scanJSON(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
		return err
	}
	if delim != '{' {
		return errors.New("unexpected JSON delimiter")
	}
	seen := map[string]struct{}{}
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return err
		}
		key, ok := keyToken.(string)
		if !ok {
			return errors.New("invalid JSON key")
		}
		key = strings.ToLower(key)
		if _, exists := seen[key]; exists {
			return fmt.Errorf("duplicate key")
		}
		seen[key] = struct{}{}
		if err := scanJSON(decoder); err != nil {
			return err
		}
	}
	_, err = decoder.Token()
	return err
}

func requireJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("history record has trailing data")
	}
	return nil
}
