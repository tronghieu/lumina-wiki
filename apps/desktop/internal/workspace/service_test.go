package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateWorkspace(t *testing.T) {
	root := filepath.Join("..", "testdata", "lumina-workspace")
	service := NewService()

	result, err := service.Validate(root)
	if err != nil {
		t.Fatalf("Validate returned error: %v", err)
	}

	if !result.Valid {
		t.Fatal("fixture workspace should be valid")
	}
	if result.Root == "" {
		t.Fatal("validated root should be absolute")
	}
	if len(result.Packs) == 0 || result.Packs[0] != "core" {
		t.Fatalf("unexpected packs: %#v", result.Packs)
	}
}

func TestSummaryCountsWorkspaceInventory(t *testing.T) {
	root := filepath.Join("..", "testdata", "lumina-workspace")
	service := NewService()

	summary, err := service.Summary(root)
	if err != nil {
		t.Fatalf("Summary returned error: %v", err)
	}

	if !summary.Valid {
		t.Fatal("fixture workspace should be valid")
	}
	if summary.Root == "" {
		t.Fatal("summary root should be absolute")
	}
	if len(summary.Packs) == 0 || summary.Packs[0] != "core" {
		t.Fatalf("unexpected packs: %#v", summary.Packs)
	}
	if summary.WikiNotes != 5 {
		t.Fatalf("expected 5 wiki notes, got %d", summary.WikiNotes)
	}
	if summary.RawSources != 0 {
		t.Fatalf("expected 0 raw sources, got %d", summary.RawSources)
	}
	if summary.RawNotes != 0 {
		t.Fatalf("expected 0 raw notes, got %d", summary.RawNotes)
	}
	if summary.GraphEdges != 5 {
		t.Fatalf("expected 5 graph edges, got %d", summary.GraphEdges)
	}
	if summary.GraphCitations != 1 {
		t.Fatalf("expected 1 graph citation, got %d", summary.GraphCitations)
	}
	expectedMissing := []string{"raw", "raw/sources", "raw/notes"}
	if len(summary.MissingExpectedFolders) != len(expectedMissing) {
		t.Fatalf("unexpected missing folders: %#v", summary.MissingExpectedFolders)
	}
	for index, folder := range expectedMissing {
		if summary.MissingExpectedFolders[index] != folder {
			t.Fatalf("expected missing folder %q at %d, got %#v", folder, index, summary.MissingExpectedFolders)
		}
	}
}

func TestSummaryReportsMissingOptionalFolders(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
		t.Fatalf("write README fixture: %v", err)
	}
	if err := os.Mkdir(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatalf("create wiki fixture: %v", err)
	}
	service := NewService()

	summary, err := service.Summary(root)
	if err != nil {
		t.Fatalf("Summary returned error: %v", err)
	}

	expected := []string{"raw", "raw/sources", "raw/notes", "wiki/graph"}
	if len(summary.MissingExpectedFolders) != len(expected) {
		t.Fatalf("expected missing folders %#v, got %#v", expected, summary.MissingExpectedFolders)
	}
	for i, folder := range expected {
		if summary.MissingExpectedFolders[i] != folder {
			t.Fatalf("expected missing folder %q at %d, got %#v", folder, i, summary.MissingExpectedFolders)
		}
	}
}

func TestSummaryDoesNotFollowSymlinkedInventoryFolders(t *testing.T) {
	outside := t.TempDir()
	if err := os.MkdirAll(filepath.Join(outside, "sources"), 0o700); err != nil {
		t.Fatalf("create outside sources: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outside, "sources", "outside.md"), []byte("outside"), 0o600); err != nil {
		t.Fatalf("write outside source: %v", err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
		t.Fatalf("write README fixture: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "wiki", "graph"), 0o700); err != nil {
		t.Fatalf("create wiki fixture: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "raw")); err != nil {
		t.Fatalf("create raw symlink: %v", err)
	}

	summary, err := NewService().Summary(root)
	if err != nil {
		t.Fatalf("Summary returned error: %v", err)
	}

	if summary.RawSources != 0 {
		t.Fatalf("expected symlinked raw sources to be skipped, got %d", summary.RawSources)
	}
	if len(summary.MissingExpectedFolders) == 0 || summary.MissingExpectedFolders[0] != "raw" {
		t.Fatalf("expected symlinked raw to be missing, got %#v", summary.MissingExpectedFolders)
	}
}

func TestSummaryDoesNotFollowSymlinkedGraphFiles(t *testing.T) {
	outside := t.TempDir()
	outsideEdges := filepath.Join(outside, "edges.jsonl")
	if err := os.WriteFile(outsideEdges, []byte("{\"from\":\"outside\"}\n"), 0o600); err != nil {
		t.Fatalf("write outside graph file: %v", err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
		t.Fatalf("write README fixture: %v", err)
	}
	graphDir := filepath.Join(root, "wiki", "graph")
	if err := os.MkdirAll(graphDir, 0o700); err != nil {
		t.Fatalf("create graph fixture: %v", err)
	}
	if err := os.Symlink(outsideEdges, filepath.Join(graphDir, "edges.jsonl")); err != nil {
		t.Fatalf("create graph symlink: %v", err)
	}

	summary, err := NewService().Summary(root)
	if err != nil {
		t.Fatalf("Summary returned error: %v", err)
	}

	if summary.GraphEdges != 0 {
		t.Fatalf("expected symlinked graph file to be skipped, got %d", summary.GraphEdges)
	}
}

func TestValidateRejectsInvalidWorkspace(t *testing.T) {
	service := NewService()
	result, err := service.Validate(t.TempDir())
	if err == nil {
		t.Fatal("expected invalid workspace error")
	}
	if result.Valid {
		t.Fatal("invalid workspace must not be marked valid")
	}
}

func TestValidateRejectsWikiFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
		t.Fatalf("write README fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "wiki"), []byte("not a directory"), 0o600); err != nil {
		t.Fatalf("write wiki fixture: %v", err)
	}

	service := NewService()
	result, err := service.Validate(root)
	if err == nil {
		t.Fatal("expected invalid workspace error")
	}
	if result.Valid {
		t.Fatal("workspace with wiki file must not be valid")
	}
}

func TestValidateRejectsSymlinkedWorkspaceEntries(t *testing.T) {
	t.Run("README", func(t *testing.T) {
		root := t.TempDir()
		outside := filepath.Join(t.TempDir(), "README.md")
		if err := os.WriteFile(outside, []byte("# Outside"), 0o600); err != nil {
			t.Fatalf("write outside README: %v", err)
		}
		if err := os.Symlink(outside, filepath.Join(root, "README.md")); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		if err := os.Mkdir(filepath.Join(root, "wiki"), 0o700); err != nil {
			t.Fatalf("create wiki: %v", err)
		}
		if _, err := NewService().Validate(root); err == nil {
			t.Fatal("expected symlinked README rejection")
		}
	})

	t.Run("wiki", func(t *testing.T) {
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
			t.Fatalf("write README: %v", err)
		}
		if err := os.Symlink(t.TempDir(), filepath.Join(root, "wiki")); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		if _, err := NewService().Validate(root); err == nil {
			t.Fatal("expected symlinked wiki rejection")
		}
	})
}

func TestResolveInsideRejectsEscape(t *testing.T) {
	root := filepath.Join("..", "testdata", "lumina-workspace")
	service := NewService()
	if _, err := service.ResolveInside(root, "../outside.md"); err == nil {
		t.Fatal("expected path escape to be rejected")
	}
}

func TestResolveInsideRejectsSymlinkedIntermediateDirectory(t *testing.T) {
	root := filepath.Join(t.TempDir(), "workspace")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatalf("create root: %v", err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(root, "raw")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := NewService().ResolveInside(root, "raw/sources/paper.md"); err == nil {
		t.Fatal("expected symlinked intermediate directory rejection")
	}
}

func TestResolveInsideRejectsBackslashTraversal(t *testing.T) {
	root := filepath.Join("..", "testdata", "lumina-workspace")
	service := NewService()
	if _, err := service.ResolveInside(root, `..\outside.md`); err == nil {
		t.Fatal("expected backslash traversal to be rejected")
	}
}
