package importer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestImportToRawSourcesCopiesWithoutOverwrite(t *testing.T) {
	root := makeImportWorkspace(t)
	source := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(source, []byte("hello"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	result, err := NewService().ImportToRawSources(root, source)
	if err != nil {
		t.Fatalf("ImportToRawSources returned error: %v", err)
	}
	if result.RelativePath != "raw/sources/paper.md" || result.Bytes != 5 {
		t.Fatalf("unexpected result: %#v", result)
	}
	copied, err := os.ReadFile(filepath.Join(root, "raw", "sources", "paper.md"))
	if err != nil {
		t.Fatalf("read copied file: %v", err)
	}
	if string(copied) != "hello" {
		t.Fatalf("unexpected copied content: %q", copied)
	}

	if _, err := NewService().ImportToRawSources(root, source); err == nil {
		t.Fatal("expected overwrite rejection")
	}
}

func TestImportToRawSourcesRejectsDirectory(t *testing.T) {
	if _, err := NewService().ImportToRawSources(makeImportWorkspace(t), t.TempDir()); err == nil {
		t.Fatal("expected directory rejection")
	}
}

func TestImportToRawSourcesRejectsSymlinkSource(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source.md")
	if err := os.WriteFile(source, []byte("hello"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	link := filepath.Join(t.TempDir(), "link.md")
	if err := os.Symlink(source, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := NewService().ImportToRawSources(makeImportWorkspace(t), link); err == nil {
		t.Fatal("expected symlink rejection")
	}
}

func TestImportToRawSourcesRejectsInvalidWorkspace(t *testing.T) {
	source := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(source, []byte("hello"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	if _, err := NewService().ImportToRawSources(t.TempDir(), source); err == nil {
		t.Fatal("expected invalid workspace rejection")
	}
}

func makeImportWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
		t.Fatalf("write README: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatalf("create wiki: %v", err)
	}
	return root
}
