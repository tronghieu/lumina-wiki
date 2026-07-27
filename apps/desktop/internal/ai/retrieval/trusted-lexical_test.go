package retrieval

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildLexicalTrustedAcceptsSameRootIdentityAndAliasProof(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "note.md"), "trusted needle")
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(root, alias); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	expected, err := os.Stat(alias)
	if err != nil {
		t.Fatal(err)
	}
	index, err := BuildLexicalTrusted(context.Background(), NewCorpus(), root, expected)
	if err != nil || index == nil {
		t.Fatalf("trusted build = %#v, %v", index, err)
	}
	result, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil || len(result.Hits) != 1 {
		t.Fatalf("trusted search = %#v, %v", result, err)
	}
}

func TestBuildLexicalTrustedRejectsReplacedRootWithoutIndex(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "note.md"), "old secret needle")
	oldIdentity, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	oldRoot := root + "-old"
	if err := os.Rename(root, oldRoot); err != nil {
		t.Fatal(err)
	}
	mustMkdir(t, filepath.Join(root, "wiki"))
	mustWrite(t, filepath.Join(root, "README.md"), "# replacement")
	mustWrite(t, filepath.Join(root, "wiki", "note.md"), "new secret needle")
	index, err := BuildLexicalTrusted(context.Background(), NewCorpus(), root, oldIdentity)
	if index != nil || !errors.Is(err, ErrWorkspaceIdentityChanged) {
		t.Fatalf("old proof accepted = %#v, %v", index, err)
	}
	if strings.Contains(err.Error(), root) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("identity error leaked detail: %v", err)
	}
	newIdentity, statErr := os.Stat(root)
	if statErr != nil {
		t.Fatal(statErr)
	}
	index, err = BuildLexicalTrusted(context.Background(), NewCorpus(), root, newIdentity)
	if err != nil || index == nil {
		t.Fatalf("new proof rejected = %#v, %v", index, err)
	}
}

func TestBuildLexicalTrustedRejectsRootReplacementDuringFirstScanAttempt(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "note.md"), "old needle")
	expected, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	corpus := NewCorpus()
	replaced := false
	corpus.afterRead = func(_ string, attempt int) {
		if replaced || attempt != 0 {
			return
		}
		replaced = true
		oldRoot := root + "-old"
		if err := os.Rename(root, oldRoot); err != nil {
			t.Fatal(err)
		}
		mustMkdir(t, filepath.Join(root, "wiki"))
		mustWrite(t, filepath.Join(root, "README.md"), "# replacement")
		mustWrite(t, filepath.Join(root, "wiki", "note.md"), "new needle")
	}
	index, err := BuildLexicalTrusted(context.Background(), corpus, root, expected)
	if !replaced || index != nil || !errors.Is(err, ErrWorkspaceIdentityChanged) {
		t.Fatalf("raced root accepted = %#v, %v", index, err)
	}
}

func TestBuildLexicalTrustedRejectsRootReplacementDuringFinalScanAttempt(t *testing.T) {
	root := workspace(t)
	note := filepath.Join(root, "wiki", "note.md")
	mustWrite(t, note, "old needle")
	expected, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	corpus := NewCorpus()
	firstChanged, finalReplaced := false, false
	corpus.afterRead = func(_ string, attempt int) {
		switch {
		case attempt == 0 && !firstChanged:
			firstChanged = true
			mustWrite(t, note, "retry needle bytes")
		case attempt == 1 && !finalReplaced:
			finalReplaced = true
			oldRoot := root + "-old"
			if err := os.Rename(root, oldRoot); err != nil {
				t.Fatal(err)
			}
			mustMkdir(t, filepath.Join(root, "wiki"))
			mustWrite(t, filepath.Join(root, "README.md"), "# replacement")
			mustWrite(t, filepath.Join(root, "wiki", "note.md"), "replacement secret")
		}
	}
	index, err := BuildLexicalTrusted(context.Background(), corpus, root, expected)
	if !firstChanged || !finalReplaced || index != nil || !errors.Is(err, ErrWorkspaceIdentityChanged) {
		t.Fatalf("final-attempt replacement accepted = changed %v replaced %v index %#v err %v", firstChanged, finalReplaced, index, err)
	}
	if strings.Contains(err.Error(), root) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("identity error leaked detail: %v", err)
	}
}

func TestBuildLexicalTrustedAllowsCurrentEmptyWorkspace(t *testing.T) {
	root := workspace(t)
	expected, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	index, err := BuildLexicalTrusted(context.Background(), NewCorpus(), root, expected)
	if err != nil || index == nil || len(index.documents) != 0 {
		t.Fatalf("valid empty workspace rejected = %#v, %v", index, err)
	}
}

func TestBuildLexicalTrustedValidatesProofAfterSnapshotWithContextPrecedence(t *testing.T) {
	root := workspace(t)
	mustWrite(t, filepath.Join(root, "wiki", "note.md"), "needle")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if index, err := BuildLexicalTrusted(ctx, NewCorpus(), root, nil); index != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost precedence = %#v, %v", index, err)
	}
	corpus := NewCorpus()
	reads := 0
	corpus.afterRead = func(string, int) { reads++ }
	index, err := BuildLexicalTrusted(context.Background(), corpus, root, nil)
	if reads == 0 || index != nil || !errors.Is(err, ErrWorkspaceIdentityChanged) {
		t.Fatalf("invalid proof did not fail after scan = reads %d, %#v, %v", reads, index, err)
	}
}
