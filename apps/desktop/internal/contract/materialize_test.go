package contract

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

func TestMaterializeUsesOnlyRuntimeInputsAndReturnsCopies(t *testing.T) {
	t.Setenv("PATH", "")
	bundle, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	rootPath := t.TempDir()
	proof, err := rootproof.Open(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })

	name := "Lumina \"Đọc: YAML # & Markdown *Wiki*\"\n第二行"
	now := time.Date(2026, 7, 25, 1, 35, 42, 123_000_000, time.FixedZone("hostile", 7*60*60))
	result, err := bundle.Materialize(RuntimeInputs{ProjectName: name, Now: now, Root: proof})
	if err != nil {
		t.Fatalf("Materialize: %v", err)
	}
	readme, ok := result.ReadFile("README.md")
	if !ok || !bytes.Contains(readme, []byte(name)) {
		t.Fatal("README does not contain the exact project name")
	}
	manifestBytes, ok := result.ReadFile("_lumina/manifest.json")
	if !ok {
		t.Fatal("manifest missing")
	}
	var manifest struct {
		InstalledAt   string            `json:"installedAt"`
		UpdatedAt     string            `json:"updatedAt"`
		ResolvedPaths map[string]string `json:"resolvedPaths"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.InstalledAt != "2026-07-24T18:35:42.123Z" || manifest.UpdatedAt != manifest.InstalledAt {
		t.Fatalf("unexpected timestamps: %+v", manifest)
	}
	if manifest.ResolvedPaths["projectRoot"] != rootPath {
		t.Fatalf("project root = %q, want %q", manifest.ResolvedPaths["projectRoot"], rootPath)
	}
	for key, suffix := range map[string]string{
		"wiki": "wiki", "raw": "raw", "agents": ".agents", "lumina": "_lumina",
	} {
		if manifest.ResolvedPaths[key] != filepath.Join(rootPath, suffix) {
			t.Fatalf("%s path = %q", key, manifest.ResolvedPaths[key])
		}
	}
	for _, forbidden := range []string{"testdata/core-generic-en.json", "/apps/desktop/", "/src/templates/"} {
		if bytes.Contains(manifestBytes, []byte(forbidden)) {
			t.Fatalf("manifest leaked %q", forbidden)
		}
	}

	files := result.Files()
	files[0].Path = "changed"
	if result.Files()[0].Path == "changed" {
		t.Fatal("Files returned shared inventory")
	}
}

func TestFilesManifestHashesExactTargetBytesInDeclaredOrder(t *testing.T) {
	bundle, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	proof, err := rootproof.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })
	result, err := bundle.Materialize(RuntimeInputs{
		ProjectName: `comma, quote " and Việt`,
		Now:         time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		Root:        proof,
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, ok := result.ReadFile("_lumina/_state/files-manifest.csv")
	if !ok {
		t.Fatal("files manifest missing")
	}
	reader := csv.NewReader(bytes.NewReader(raw))
	rows, err := reader.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	contractView := bundle.Contract()
	if got, want := len(rows), len(contractView.State.ManagedFilePaths)+1; got != want {
		t.Fatalf("row count = %d, want %d", got, want)
	}
	for i, path := range contractView.State.ManagedFilePaths {
		if rows[i+1][0] != path {
			t.Fatalf("row %d path = %q, want %q", i, rows[i+1][0], path)
		}
		file, ok := result.ReadFile(path)
		if !ok {
			t.Fatalf("managed file missing: %s", path)
		}
		if rows[i+1][1] != sha256Hex(file) {
			t.Fatalf("wrong hash for %s", path)
		}
	}

	skills, ok := result.ReadFile("_lumina/_state/skills-manifest.csv")
	if !ok || !strings.HasSuffix(string(skills), "\n") {
		t.Fatal("skills CSV missing or lacks final newline")
	}
	if _, err := csv.NewReader(strings.NewReader(string(skills))).ReadAll(); err != nil && err != io.EOF {
		t.Fatalf("invalid skills CSV: %v", err)
	}
	if _, err := os.Stat(filepath.Join(proof.Path(), "README.md")); !os.IsNotExist(err) {
		t.Fatal("Materialize wrote to disk")
	}
}

func TestMaterializeFixedCrossLanguageFixtureInventory(t *testing.T) {
	rawFixture, err := os.ReadFile("testdata/core-generic-en.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Now         string `json:"now"`
		Profile     string `json:"profile"`
		ProjectName string `json:"projectName"`
	}
	if err := json.Unmarshal(rawFixture, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Profile != "core-generic-en" {
		t.Fatalf("fixture profile = %q", fixture.Profile)
	}
	now, err := time.Parse(time.RFC3339Nano, fixture.Now)
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	proof, err := rootproof.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })
	result, err := bundle.Materialize(RuntimeInputs{
		ProjectName: fixture.ProjectName,
		Now:         now,
		Root:        proof,
	})
	if err != nil {
		t.Fatal(err)
	}
	view := bundle.Contract()
	if got, want := len(result.Directories()), len(view.Directories); got != want {
		t.Fatalf("directory count = %d, want %d", got, want)
	}
	if got, want := len(result.Files()), len(view.Payload.Entries)+4; got != want {
		t.Fatalf("file count = %d, want %d", got, want)
	}
	payload := bundle.Payload()
	for _, entry := range view.Payload.Entries {
		materialized, ok := result.ReadFile(entry.Path)
		if !ok {
			t.Fatalf("materialized inventory lacks %q", entry.Path)
		}
		if entry.Kind != "static" {
			continue
		}
		source, err := fs.ReadFile(payload, entry.Path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(materialized, source) {
			t.Fatalf("static payload changed: %q", entry.Path)
		}
	}
	readme, ok := result.ReadFile("README.md")
	if !ok || !bytes.HasPrefix(readme, []byte("# "+fixture.ProjectName+"\n")) {
		t.Fatal("fixture project name was not rendered exactly")
	}
	for _, file := range result.Files() {
		for _, leaked := range []string{
			"testdata/core-generic-en.json",
			"internal/contract/assets",
			"/Users/plateau/Project/lumina-wiki",
		} {
			if bytes.Contains(file.Bytes(), []byte(leaked)) {
				t.Fatalf("%s leaks build input %q", file.Path, leaked)
			}
		}
	}
}

func TestMaterializeRejectsOversizedProjectName(t *testing.T) {
	bundle, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	proof, err := rootproof.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })
	_, err = bundle.Materialize(RuntimeInputs{
		ProjectName: strings.Repeat("a", maxProjectNameBytes+1),
		Now:         time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		Root:        proof,
	})
	if err == nil {
		t.Fatal("Materialize accepted an oversized project name")
	}
}

func TestMaterializeRejectsRenderedOutputBeyondIndependentLimit(t *testing.T) {
	loaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	proof, err := rootproof.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })

	template := []byte(strings.Repeat("{{project_name}}", maxMaterializedFileBytes/128))
	view := loaded.Contract()
	view.Payload.Entries = []PayloadEntry{{
		Kind: "template", Path: "README.md", SHA256: sha256Hex(template), Size: int64(len(template)),
	}}
	payload := fstest.MapFS{
		"README.md": &fstest.MapFile{Data: template, Mode: 0o444},
	}
	hostile := Bundle{data: &bundleData{contract: view, payload: payload}}
	_, err = hostile.Materialize(RuntimeInputs{
		ProjectName: strings.Repeat("x", maxProjectNameBytes),
		Now:         time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		Root:        proof,
	})
	if err == nil {
		t.Fatal("Materialize accepted rendered output beyond its independent limit")
	}
}

func TestMaterializeRefusesRuntimeStateOverwriteEvenForBypassedBundle(t *testing.T) {
	loaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	proof, err := rootproof.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })

	view := loaded.Contract()
	name := "_lumina/config/lumina.config.yaml"
	data := []byte("hostile\n")
	view.Payload.Entries = append(view.Payload.Entries, PayloadEntry{
		Kind: "static", Path: name, SHA256: sha256Hex(data), Size: int64(len(data)),
	})
	sort.Slice(view.Payload.Entries, func(i, j int) bool {
		return view.Payload.Entries[i].Path < view.Payload.Entries[j].Path
	})
	payload := loaded.data.payload
	payload = cloneMapFS(payload)
	payload[name] = &fstest.MapFile{Data: data, Mode: 0o444}
	hostile := Bundle{data: &bundleData{contract: view, payload: payload}}
	_, err = hostile.Materialize(RuntimeInputs{
		ProjectName: "Collision",
		Now:         time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		Root:        proof,
	})
	if err == nil {
		t.Fatal("Materialize silently overwrote a colliding payload path")
	}
}

func cloneMapFS(source fstest.MapFS) fstest.MapFS {
	result := make(fstest.MapFS, len(source))
	for name, entry := range source {
		copied := *entry
		copied.Data = append([]byte(nil), entry.Data...)
		result[name] = &copied
	}
	return result
}
