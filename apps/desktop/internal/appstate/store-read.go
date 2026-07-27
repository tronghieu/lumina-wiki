package appstate

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

func encodeSnapshot(snapshot Snapshot) ([]byte, error) {
	if err := snapshot.validate(); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, ErrInvalidState
	}
	raw = append(raw, '\n')
	if len(raw) > MaxStateBytes {
		return nil, ErrInvalidState
	}
	return raw, nil
}

func decodeSnapshot(raw []byte) (Snapshot, error) {
	if len(raw) == 0 || len(raw) > MaxStateBytes || rejectDuplicateKeys(raw) != nil {
		return Snapshot{}, ErrCorruptState
	}
	var snapshot Snapshot
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil {
		return Snapshot{}, ErrCorruptState
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return Snapshot{}, ErrCorruptState
	}
	if err := snapshot.validate(); err != nil {
		return Snapshot{}, ErrCorruptState
	}
	return snapshot, nil
}

func rejectDuplicateKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := scanJSON(decoder); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
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
			return fmt.Errorf("duplicate JSON key")
		}
		seen[key] = struct{}{}
		if err := scanJSON(decoder); err != nil {
			return err
		}
	}
	_, err = decoder.Token()
	return err
}
