package workspace

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"strconv"
	"strings"
)

const (
	currentManifestSchema = 4
	maxManifestBytes      = 1024 * 1024
	maxStateCSVBytes      = 4 * 1024 * 1024
)

type manifestStatus uint8

const (
	manifestMissing manifestStatus = iota
	manifestSupported
	manifestNewer
	manifestMalformed
)

func inspectManifest(ctx context.Context, root *os.Root) (manifestStatus, error) {
	if err := ctx.Err(); err != nil {
		return manifestMalformed, err
	}
	info, err := root.Lstat("_lumina/manifest.json")
	if errors.Is(err, fs.ErrNotExist) {
		return manifestMissing, nil
	}
	if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() ||
		info.Size() < 1 || info.Size() > maxManifestBytes {
		return manifestMalformed, nil
	}
	file, err := root.Open("_lumina/manifest.json")
	if err != nil {
		return manifestMalformed, nil
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return manifestMalformed, nil
	}
	raw, err := io.ReadAll(io.LimitReader(file, maxManifestBytes+1))
	if err != nil || len(raw) > maxManifestBytes {
		return manifestMalformed, nil
	}
	version, ok := decodeManifestVersion(raw)
	if !ok {
		return manifestMalformed, nil
	}
	if !validStateCSV(root, "_lumina/_state/skills-manifest.csv",
		"canonical_id,display_name,pack,source,relative_path,target_link_path,version") ||
		!validStateCSV(root, "_lumina/_state/files-manifest.csv",
			"relative_path,sha256,source_pack,installed_version") {
		return manifestMalformed, nil
	}
	if !validSkillsCSVRows(root) || !validFilesCSVRows(root) {
		return manifestMalformed, nil
	}
	if version > currentManifestSchema {
		return manifestNewer, nil
	}
	if version < 1 {
		return manifestMalformed, nil
	}
	return manifestSupported, nil
}

func validSkillsCSVRows(root *os.Root) bool {
	rows, ok := readCSVRows(root, "_lumina/_state/skills-manifest.csv", 7)
	if !ok {
		return false
	}
	seen := make(map[string]struct{})
	for _, row := range rows[1:] {
		id, relativePath := row[0], row[4]
		if id == "" || relativePath != ".agents/skills/"+id {
			return false
		}
		if _, exists := seen[id]; exists {
			return false
		}
		seen[id] = struct{}{}
		info, err := treeLstat(root, relativePath)
		if err != nil || !info.IsDir() {
			return false
		}
	}
	return true
}

func validFilesCSVRows(root *os.Root) bool {
	rows, ok := readCSVRows(root, "_lumina/_state/files-manifest.csv", 4)
	if !ok {
		return false
	}
	seen := make(map[string]struct{})
	for _, row := range rows[1:] {
		name, digest := row[0], row[1]
		if name == "" || len(digest) != 64 {
			return false
		}
		if _, exists := seen[strings.ToLower(name)]; exists {
			return false
		}
		seen[strings.ToLower(name)] = struct{}{}
		info, err := treeLstat(root, name)
		if err != nil || !info.Mode().IsRegular() || info.Size() > maxStateCSVBytes {
			return false
		}
		raw, err := readRootFile(root, name, int(info.Size()))
		if err != nil {
			return false
		}
		sum := sha256.Sum256(raw)
		if hex.EncodeToString(sum[:]) != digest {
			return false
		}
	}
	return true
}

func readCSVRows(root *os.Root, name string, columns int) ([][]string, bool) {
	info, err := treeLstat(root, name)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxStateCSVBytes {
		return nil, false
	}
	raw, err := readRootFile(root, name, int(info.Size()))
	if err != nil {
		return nil, false
	}
	reader := csv.NewReader(bytes.NewReader(raw))
	reader.FieldsPerRecord = columns
	rows, err := reader.ReadAll()
	return rows, err == nil && len(rows) >= 1
}

func decodeManifestVersion(raw []byte) (int, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return 0, false
	}
	found := false
	version := 1
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return 0, false
		}
		key, ok := keyToken.(string)
		if !ok {
			return 0, false
		}
		if strings.EqualFold(key, "schemaVersion") {
			if found {
				return 0, false
			}
			found = true
			var value any
			if err := decoder.Decode(&value); err != nil {
				return 0, false
			}
			switch typed := value.(type) {
			case nil:
				version = 1
			case json.Number:
				parsed, err := strconv.ParseInt(string(typed), 10, 32)
				if err != nil {
					return 0, false
				}
				version = int(parsed)
			default:
				return 0, false
			}
			continue
		}
		var discard any
		if err := decoder.Decode(&discard); err != nil {
			return 0, false
		}
	}
	if _, err := decoder.Token(); err != nil {
		return 0, false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return 0, false
	}
	return version, true
}

func validStateCSV(root *os.Root, name, header string) bool {
	info, err := root.Lstat(name)
	if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.Mode().IsRegular() ||
		info.Size() < int64(len(header)+1) || info.Size() > maxStateCSVBytes {
		return false
	}
	file, err := root.Open(name)
	if err != nil {
		return false
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return false
	}
	prefix := make([]byte, len(header)+1)
	if _, err := io.ReadFull(file, prefix); err != nil {
		return false
	}
	return string(prefix) == header+"\n"
}
