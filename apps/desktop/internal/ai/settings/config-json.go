package settings

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const MaxConfigBytes = 256 * 1024

func newConfigEncoder(destination io.Writer) *json.Encoder {
	encoder := json.NewEncoder(destination)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder
}

func decodeConfig(raw []byte) (Config, error) {
	if err := rejectDuplicateJSONKeys(raw); err != nil {
		return Config{}, err
	}
	var config Config
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return Config{}, fmt.Errorf("decode AI settings: %w", err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return Config{}, err
	}
	return config.Normalized()
}

func rejectDuplicateJSONKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := scanJSONValue(decoder); err != nil {
		return fmt.Errorf("decode AI settings: %w", err)
	}
	if token, err := decoder.Token(); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("decode AI settings: unexpected token %v", token)
		}
		return fmt.Errorf("decode AI settings: %w", err)
	}
	return nil
}

func scanJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("object key is not a string")
			}
			canonicalKey := strings.ToLower(key)
			if _, exists := seen[canonicalKey]; exists {
				return fmt.Errorf("duplicate JSON key %q", key)
			}
			seen[canonicalKey] = struct{}{}
			if err := scanJSONValue(decoder); err != nil {
				return err
			}
		}
	case '[':
		for decoder.More() {
			if err := scanJSONValue(decoder); err != nil {
				return err
			}
		}
	default:
		return errors.New("unexpected closing JSON delimiter")
	}
	_, err = decoder.Token()
	return err
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("decode AI settings: multiple JSON values")
		}
		return fmt.Errorf("decode AI settings: %w", err)
	}
	return nil
}
