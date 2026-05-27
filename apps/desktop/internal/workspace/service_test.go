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

func TestResolveInsideRejectsEscape(t *testing.T) {
	root := filepath.Join("..", "testdata", "lumina-workspace")
	service := NewService()
	if _, err := service.ResolveInside(root, "../outside.md"); err == nil {
		t.Fatal("expected path escape to be rejected")
	}
}

func TestResolveInsideRejectsBackslashTraversal(t *testing.T) {
	root := filepath.Join("..", "testdata", "lumina-workspace")
	service := NewService()
	if _, err := service.ResolveInside(root, `..\outside.md`); err == nil {
		t.Fatal("expected backslash traversal to be rejected")
	}
}
