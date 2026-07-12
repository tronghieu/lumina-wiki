package retrieval_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func TestLexicalChunksReturnsDeterministicDeepCopy(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("workspace"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "wiki", "b.md"), []byte("# B\n\nbeta"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "wiki", "a.md"), []byte("# A\n\nalpha"), 0o600); err != nil {
		t.Fatal(err)
	}
	lexical, err := retrieval.BuildLexical(context.Background(), nil, root)
	if err != nil {
		t.Fatal(err)
	}
	first, err := lexical.Chunks(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 || first[0].ID >= first[1].ID {
		t.Fatalf("not ID sorted: %#v", first)
	}
	first[0].Text = "mutated"
	second, err := lexical.Chunks(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if second[0].Text == "mutated" {
		t.Fatal("returned storage aliases lexical state")
	}
}
