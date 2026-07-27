package workspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

func TestValidateTrustedUsesHeldRootWithoutMutation(t *testing.T) {
	root := makeTreeWorkspace(t)
	before := snapshotWorkspace(t, root)
	proof, err := rootproof.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })
	result, err := NewService().ValidateTrusted(context.Background(), root, proof)
	if err != nil || !result.Valid {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	after := snapshotWorkspace(t, root)
	if before != after {
		t.Fatal("ValidateTrusted mutated the workspace")
	}
}

func TestValidateTrustedRejectsReplacementAndLinks(t *testing.T) {
	root := makeTreeWorkspace(t)
	proof, err := rootproof.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })
	if !renameHeldWorkspaceRootForTest(t, root, root+"-old") {
		if err := proof.Validate(); err != nil {
			t.Fatalf("proof invalid after operating system blocked replacement: %v", err)
		}
		return
	}
	if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("replacement"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewService().ValidateTrusted(context.Background(), root, proof); err == nil {
		t.Fatal("replacement was accepted")
	}
}

func snapshotWorkspace(t *testing.T, root string) string {
	t.Helper()
	var result string
	err := filepath.Walk(root, func(name string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		result += rel + "|" + info.Mode().String() + "\n"
		if info.Mode().IsRegular() {
			raw, err := os.ReadFile(name)
			if err != nil {
				return err
			}
			result += string(raw) + "\n"
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}
