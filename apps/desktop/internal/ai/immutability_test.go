package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/importer"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

func TestReadOnlyDesktopWorkflowsPreserveWorkspaceBytes(t *testing.T) {
	root := immutableWorkspace(t)
	workspaceService := workspace.NewService()
	graphService := graph.NewService()
	corpus := retrieval.NewCorpus()
	var lexical *retrieval.Lexical

	workflows := []struct {
		name string
		run  func() error
	}{
		{"validate", func() error { _, err := workspaceService.Validate(root); return err }},
		{"summary", func() error { _, err := workspaceService.Summary(root); return err }},
		{"resolve inside", func() error { _, err := workspaceService.ResolveInside(root, "wiki/concepts/topic.md"); return err }},
		{"load graph", func() error { _, err := graphService.Load(root); return err }},
		{"read note", func() error { _, err := graphService.ReadNote(root, "concepts/topic.md"); return err }},
		{"snapshot corpus", func() error { _, err := corpus.Snapshot(context.Background(), root); return err }},
		{"build lexical index", func() error {
			var err error
			lexical, err = retrieval.BuildLexical(context.Background(), corpus, root)
			return err
		}},
		{"search lexical index", func() error {
			_, err := lexical.Search(context.Background(), "grounded topic", retrieval.SearchOptions{Limit: 5})
			return err
		}},
		{"run check", func() error {
			_, err := tools.NewService().RunCheck(root)
			return err
		}},
	}

	for _, workflow := range workflows {
		t.Run(workflow.name, func(t *testing.T) {
			before := hashWorkspaceManifest(t, root)
			if err := workflow.run(); err != nil {
				t.Fatal(err)
			}
			after := hashWorkspaceManifest(t, root)
			if !reflect.DeepEqual(before, after) {
				t.Fatalf("workspace bytes changed: before=%v after=%v", before, after)
			}
		})
	}
}

func TestImportAddsExactlyOneRawSourceWithoutChangingExistingBytes(t *testing.T) {
	root := immutableWorkspace(t)
	sourceRoot := t.TempDir()
	source := filepath.Join(sourceRoot, "evidence.txt")
	if err := os.WriteFile(source, []byte("new evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	before := hashWorkspaceManifest(t, root)
	result, err := importer.NewService().ImportToRawSources(root, source)
	if err != nil {
		t.Fatal(err)
	}
	if result.RelativePath != "raw/sources/evidence.txt" {
		t.Fatalf("relative path=%q", result.RelativePath)
	}
	after := hashWorkspaceManifest(t, root)
	if len(after) != len(before)+1 {
		t.Fatalf("manifest count before=%d after=%d", len(before), len(after))
	}
	for path, hash := range before {
		if after[path] != hash {
			t.Fatalf("existing workspace file changed: %s", path)
		}
	}
	wantHash := sha256.Sum256([]byte("new evidence"))
	if after[result.RelativePath] != hex.EncodeToString(wantHash[:]) {
		t.Fatalf("imported hash=%q", after[result.RelativePath])
	}
}

func TestGeneratedBindingsAndFrontendStorageDoNotExposeSecrets(t *testing.T) {
	frontendRoot := filepath.Join("..", "..", "frontend")
	forbiddenBinding := regexp.MustCompile(`(?i)export function (get|read|load|list)[A-Za-z]*(secret|credentialvalue|apikey|token)`)
	bindingsRoot := filepath.Join(frontendRoot, "bindings")
	err := filepath.WalkDir(bindingsRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || !strings.HasSuffix(path, ".ts") {
			return walkErr
		}
		binding, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if forbiddenBinding.Match(binding) {
			t.Fatalf("generated binding exposes a secret-reading function in %s: %s", path, forbiddenBinding.Find(binding))
		}
		for _, forbidden := range []string{"authorization", "secretvalue", "credentialvalue", "apikey", "prompt", "excerpt", "transcript"} {
			if strings.Contains(strings.ToLower(string(binding)), forbidden) {
				t.Fatalf("generated binding %s exposes %q", path, forbidden)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	sourceRoot := filepath.Join(frontendRoot, "src")
	err = filepath.WalkDir(sourceRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || (!strings.HasSuffix(path, ".ts") && !strings.HasSuffix(path, ".tsx")) {
			return walkErr
		}
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		source := string(raw)
		if strings.Contains(source, "sessionStorage") {
			t.Fatalf("session storage is forbidden: %s", path)
		}
		if strings.Contains(source, "localStorage") && !strings.Contains(source, "lumina.desktop.theme") {
			t.Fatalf("non-theme local storage is forbidden: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func hashWorkspaceManifest(t *testing.T, root string) map[string]string {
	t.Helper()
	manifest := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(raw)
		manifest[filepath.ToSlash(relative)] = hex.EncodeToString(digest[:])
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return manifest
}

func immutableWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"README.md":                  "# Lumina fixture\n",
		"wiki/concepts/topic.md":     "---\nid: topic\ntitle: Topic\ntype: concept\n---\n# Topic\n\nGrounded topic evidence.\n",
		"wiki/graph/edges.jsonl":     "",
		"wiki/graph/citations.jsonl": "",
		"raw/sources/existing.txt":   "existing source",
		"_lumina/scripts/lint.mjs":   `console.log(JSON.stringify({errors:0,warnings:0,by_check:{},fixable:0}))`,
	}
	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		target := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(files[path]), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}
