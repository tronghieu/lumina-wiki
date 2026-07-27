package contract

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"io/fs"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestLoadEmbeddedContractAndDotfileCoverage(t *testing.T) {
	bundle, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	view := bundle.Contract()
	if view.Versions.Contract != 1 || view.Profile.ID != "core-generic-en" {
		t.Fatalf("unexpected contract view: %+v %+v", view.Versions, view.Profile)
	}
	for _, name := range []string{
		".gitignore",
		".agents/skills/lumi-init/SKILL.md",
		"_lumina/CHANGELOG.md",
	} {
		if _, err := fs.ReadFile(bundle.Payload(), name); err != nil {
			t.Fatalf("embedded payload lacks %q: %v", name, err)
		}
	}
}

func TestContractAndPayloadViewsAreIndependent(t *testing.T) {
	bundle, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	first := bundle.Contract()
	first.Directories[0] = "changed"
	first.Payload.Entries[0].Path = "changed"
	second := bundle.Contract()
	if second.Directories[0] == "changed" || second.Payload.Entries[0].Path == "changed" {
		t.Fatal("Contract returned mutable shared state")
	}

	original, err := fs.ReadFile(bundle.Payload(), ".gitignore")
	if err != nil {
		t.Fatal(err)
	}
	original[0] ^= 0xff
	again, err := fs.ReadFile(bundle.Payload(), ".gitignore")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(original, again) {
		t.Fatal("Payload returned mutable shared bytes")
	}
}

func TestZeroBundlePayloadIsEmptyAndSafe(t *testing.T) {
	var bundle Bundle
	payload := bundle.Payload()
	if payload == nil {
		t.Fatal("zero bundle returned a nil payload filesystem")
	}
	if _, err := fs.ReadFile(payload, "anything"); err == nil {
		t.Fatal("zero bundle payload unexpectedly contains a file")
	}
}

func TestEmbeddedChecksumIsStrict(t *testing.T) {
	valid, err := fs.Sub(embeddedAssets, "assets")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := fs.ReadFile(valid, "contract.json")
	if err != nil {
		t.Fatal(err)
	}
	payload, err := fs.Sub(valid, "payload")
	if err != nil {
		t.Fatal(err)
	}
	bad := overlayFS{
		FS: valid,
		files: map[string][]byte{
			"contract.sha256": []byte("not-a-checksum\n"),
		},
	}
	if _, err := loadFS(bad); err == nil {
		t.Fatal("loadFS accepted malformed checksum")
	}
	bad.files["contract.sha256"] = []byte("1fd5b8e1d140ef6ee5ef892d6528888b570aaba160e89f7ef9268cd169ae0a43")
	if _, err := loadFS(bad); err == nil {
		t.Fatal("loadFS accepted checksum without final newline")
	}
	_ = raw
	_ = payload
}

func TestLoaderRejectsHostileContractMetadata(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{
			name: "unknown contract version",
			mutate: func(value map[string]any) {
				value["versions"].(map[string]any)["contract"] = float64(2)
			},
		},
		{
			name:   "unknown top-level field",
			mutate: func(value map[string]any) { value["unexpected"] = true },
		},
		{
			name: "unknown schema field",
			mutate: func(value map[string]any) {
				value["schema"].(map[string]any)["unexpected"] = true
			},
		},
		{
			name: "unsafe traversal path",
			mutate: func(value map[string]any) {
				value["payload"].(map[string]any)["entries"].([]any)[0].(map[string]any)["path"] = "../escape"
			},
		},
		{
			name: "case collision",
			mutate: func(value map[string]any) {
				entries := value["payload"].(map[string]any)["entries"].([]any)
				entries[1].(map[string]any)["path"] = strings.ToUpper(entries[0].(map[string]any)["path"].(string))
			},
		},
		{
			name: "independent file count ceiling",
			mutate: func(value map[string]any) {
				value["limits"].(map[string]any)["fileCount"] = float64(maxPayloadFiles + 1)
			},
		},
		{
			name: "independent total byte ceiling",
			mutate: func(value map[string]any) {
				value["limits"].(map[string]any)["totalBytes"] = float64(maxPayloadTotalBytes + 1)
			},
		},
		{
			name: "per-file hash drift",
			mutate: func(value map[string]any) {
				value["payload"].(map[string]any)["entries"].([]any)[0].(map[string]any)["sha256"] = strings.Repeat("0", 64)
			},
		},
		{
			name: "root digest drift",
			mutate: func(value map[string]any) {
				value["payload"].(map[string]any)["rootDigest"] = strings.Repeat("0", 64)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			hostile := clonedAssets(t)
			var value map[string]any
			if err := json.Unmarshal(hostile["contract.json"].Data, &value); err != nil {
				t.Fatal(err)
			}
			test.mutate(value)
			raw, err := canonicalJSON(value)
			if err != nil {
				t.Fatal(err)
			}
			setContractBytes(hostile, raw)
			if _, err := loadFS(hostile); err == nil {
				t.Fatal("loadFS accepted hostile contract")
			}
		})
	}
}

func TestLoaderRejectsSelfConsistentRedefinitionOfPinnedSemantics(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{
			name: "installer package",
			mutate: func(value map[string]any) {
				value["versions"].(map[string]any)["installerPackage"] = "9.9.9"
				materialization := value["materialization"].(map[string]any)
				materialization["manifest"].(map[string]any)["packageVersion"] = "9.9.9"
				materialization["state"].(map[string]any)["filesCsv"].(map[string]any)["installedVersion"] = "9.9.9"
				for _, row := range materialization["state"].(map[string]any)["skillsCsv"].(map[string]any)["rows"].([]any) {
					row.(map[string]any)["version"] = "9.9.9"
				}
			},
		},
		{
			name: "manifest schema",
			mutate: func(value map[string]any) {
				value["versions"].(map[string]any)["manifestSchema"] = float64(5)
				value["materialization"].(map[string]any)["manifest"].(map[string]any)["schemaVersion"] = float64(5)
			},
		},
		{
			name: "wiki schema",
			mutate: func(value map[string]any) {
				value["versions"].(map[string]any)["wikiSchema"] = "99.0.0"
			},
		},
		{
			name: "profile language",
			mutate: func(value map[string]any) {
				value["profile"].(map[string]any)["communicationLang"] = "Hostile"
				value["materialization"].(map[string]any)["config"].(map[string]any)["communication_language"] = "Hostile"
			},
		},
		{
			name: "skill metadata",
			mutate: func(value map[string]any) {
				value["skills"].([]any)[0].(map[string]any)["displayName"] = "/hostile-init"
			},
		},
		{
			name: "recipe semantics",
			mutate: func(value map[string]any) {
				value["materialization"].(map[string]any)["hash"].(map[string]any)["filesManifestInput"] = "attacker-selected bytes"
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			hostile := clonedAssets(t)
			var value map[string]any
			if err := json.Unmarshal(hostile["contract.json"].Data, &value); err != nil {
				t.Fatal(err)
			}
			test.mutate(value)
			raw, err := canonicalJSON(value)
			if err != nil {
				t.Fatal(err)
			}
			setContractBytes(hostile, raw)
			if _, err := loadFS(hostile); err == nil {
				t.Fatal("loadFS accepted a self-consistent redefinition of pinned semantics")
			}
		})
	}
}

func TestLoaderRejectsPayloadCollisionWithRuntimeState(t *testing.T) {
	hostile := clonedAssets(t)
	var contract Contract
	if err := json.Unmarshal(hostile["contract.json"].Data, &contract); err != nil {
		t.Fatal(err)
	}
	data := []byte("hostile config payload\n")
	name := "_lumina/config/lumina.config.yaml"
	hostile["payload/"+name] = &fstest.MapFile{Data: data, Mode: 0o444}
	contract.Payload.Entries = append(contract.Payload.Entries, PayloadEntry{
		Kind: "static", Path: name, SHA256: sha256Hex(data), Size: int64(len(data)),
	})
	sort.Slice(contract.Payload.Entries, func(i, j int) bool {
		return contract.Payload.Entries[i].Path < contract.Payload.Entries[j].Path
	})
	contract.Limits.FileCount++
	contract.Limits.TotalBytes += int64(len(data))
	contract.Payload.TotalFiles++
	contract.Payload.TotalBytes += int64(len(data))
	records := make([]digestRecord, 0, len(contract.Directories)+len(contract.Payload.Entries))
	for _, directory := range contract.Directories {
		records = append(records, digestRecord{"directory", directory, 0, "-"})
	}
	for _, entry := range contract.Payload.Entries {
		records = append(records, digestRecord{entry.Kind, entry.Path, entry.Size, entry.SHA256})
	}
	contract.Payload.RootDigest = rootDigest(records)
	raw, err := canonicalJSON(contract)
	if err != nil {
		t.Fatal(err)
	}
	setContractBytes(hostile, raw)
	if _, err := loadFS(hostile); err == nil {
		t.Fatal("loadFS accepted a payload/runtime-state path collision")
	}
}

func TestLoaderRejectsDuplicateKeysMissingAndSpecialPayload(t *testing.T) {
	t.Run("case-insensitive duplicate JSON key", func(t *testing.T) {
		hostile := clonedAssets(t)
		raw := hostile["contract.json"].Data
		raw = bytes.Replace(raw, []byte(`"versions":`), []byte(`"VERSIONS":{},"versions":`), 1)
		setContractBytes(hostile, raw)
		if _, err := loadFS(hostile); err == nil {
			t.Fatal("loadFS accepted duplicate JSON key")
		}
	})
	t.Run("missing payload", func(t *testing.T) {
		hostile := clonedAssets(t)
		delete(hostile, "payload/.gitignore")
		if _, err := loadFS(hostile); err == nil {
			t.Fatal("loadFS accepted missing payload")
		}
	})
	t.Run("special payload", func(t *testing.T) {
		hostile := clonedAssets(t)
		hostile["payload/special"] = &fstest.MapFile{Mode: fs.ModeSymlink | 0o777}
		if _, err := loadFS(hostile); err == nil {
			t.Fatal("loadFS accepted special payload")
		}
	})
}

func clonedAssets(t *testing.T) fstest.MapFS {
	t.Helper()
	assets, err := fs.Sub(embeddedAssets, "assets")
	if err != nil {
		t.Fatal(err)
	}
	result := make(fstest.MapFS)
	err = fs.WalkDir(assets, ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == "." {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			result[name] = &fstest.MapFile{Mode: fs.ModeDir | 0o555}
			return nil
		}
		data, err := fs.ReadFile(assets, name)
		if err != nil {
			return err
		}
		result[name] = &fstest.MapFile{Data: append([]byte(nil), data...), Mode: info.Mode()}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func setContractBytes(assets fstest.MapFS, raw []byte) {
	assets["contract.json"] = &fstest.MapFile{Data: append([]byte(nil), raw...), Mode: 0o444}
	sum := sha256.Sum256(raw)
	checksum := hex.EncodeToString(sum[:]) + "\n"
	assets["contract.sha256"] = &fstest.MapFile{Data: []byte(checksum), Mode: 0o444}
}

type overlayFS struct {
	fs.FS
	files map[string][]byte
}

func (o overlayFS) Open(name string) (fs.File, error) {
	if data, ok := o.files[name]; ok {
		return &memoryFile{name: name, data: append([]byte(nil), data...)}, nil
	}
	return o.FS.Open(name)
}

type memoryFile struct {
	name string
	data []byte
	off  int
}

func (f *memoryFile) Stat() (fs.FileInfo, error) { return memoryInfo{f.name, int64(len(f.data))}, nil }
func (f *memoryFile) Close() error               { return nil }
func (f *memoryFile) Read(p []byte) (int, error) {
	if f.off >= len(f.data) {
		return 0, io.EOF
	}
	n := copy(p, f.data[f.off:])
	f.off += n
	return n, nil
}

type memoryInfo struct {
	name string
	size int64
}

func (i memoryInfo) Name() string       { return i.name }
func (i memoryInfo) Size() int64        { return i.size }
func (i memoryInfo) Mode() fs.FileMode  { return 0 }
func (i memoryInfo) ModTime() time.Time { return time.Time{} }
func (i memoryInfo) IsDir() bool        { return false }
func (i memoryInfo) Sys() any           { return nil }
