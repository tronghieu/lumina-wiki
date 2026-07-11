package retrieval

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func buildSearch(t *testing.T, files map[string]string) (*Lexical, string) {
	t.Helper()
	root := workspace(t)
	for path, content := range files {
		mustWrite(t, filepath.Join(root, filepath.FromSlash(path)), content)
	}
	index, err := BuildLexical(context.Background(), NewCorpus(), root)
	if err != nil {
		t.Fatal(err)
	}
	return index, root
}

func TestLexicalRanksRareExactTermsAndStableTies(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{
		"wiki/a.md": "common common quasar",
		"wiki/b.md": "common common common",
		"wiki/c.md": "quasar",
		"wiki/d.md": "quasar",
	})
	result, err := index.Search(context.Background(), "quasar", SearchOptions{Limit: 4})
	if err != nil {
		t.Fatal(err)
	}
	paths := hitPaths(result.Hits)
	if !reflect.DeepEqual(paths, []string{"wiki/c.md", "wiki/d.md", "wiki/a.md"}) {
		t.Fatalf("ranking = %#v", paths)
	}
	second, err := index.Search(context.Background(), "quasar", SearchOptions{Limit: 4})
	if err != nil || !reflect.DeepEqual(result, second) {
		t.Fatalf("unstable result: %#v %#v %v", result, second, err)
	}
}

func TestLexicalBoostsDoNotHideOverwhelmingExactMatch(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{
		"wiki/exact.md":    strings.Repeat("needle ", 30),
		"wiki/selected.md": "needle unrelated filler filler filler",
		"wiki/linked.md":   "needle unrelated filler filler filler filler",
	})
	result, err := index.Search(context.Background(), "needle", SearchOptions{Limit: 3, SelectedPath: "wiki/selected.md", LinkedPaths: []string{"wiki/linked.md"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Hits[0].Path != "wiki/exact.md" || result.Hits[1].Path != "wiki/selected.md" {
		t.Fatalf("boost ranking = %#v", hitPaths(result.Hits))
	}
}

func TestLexicalBoundsDeduplicatesOptionsAndHandlesPunctuation(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "alpha"})
	result, err := index.Search(context.Background(), "!!!", SearchOptions{})
	if err != nil || len(result.Hits) != 0 {
		t.Fatalf("punctuation = %#v %v", result, err)
	}
	if _, err := index.Search(context.Background(), strings.Repeat("x", MaxQueryBytes+1), SearchOptions{}); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("query cap = %v", err)
	}
	linked := make([]string, MaxLinkedPaths+1)
	for i := range linked {
		linked[i] = "wiki/a.md"
	}
	if _, err := index.Search(context.Background(), "alpha", SearchOptions{LinkedPaths: linked}); err != nil {
		t.Fatalf("deduplicated options = %v", err)
	}
	for i := range linked {
		linked[i] = "wiki/path-" + strings.Repeat("x", i) + ".md"
	}
	if _, err := index.Search(context.Background(), "alpha", SearchOptions{LinkedPaths: linked}); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("linked cap = %v", err)
	}
}

func TestLexicalRereadsCurrentEvidenceAndSuppressesStaleBytes(t *testing.T) {
	for _, mutation := range []string{"changed", "deleted", "symlink"} {
		t.Run(mutation, func(t *testing.T) {
			index, root := buildSearch(t, map[string]string{"wiki/custom/note.md": "secret-before needle"})
			path := filepath.Join(root, "wiki", "custom", "note.md")
			switch mutation {
			case "changed":
				mustWrite(t, path, "secret-after needle")
			case "deleted":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				outside := filepath.Join(t.TempDir(), "outside.md")
				mustWrite(t, outside, "secret-outside needle")
				if err := os.Symlink(outside, path); err != nil {
					t.Fatal(err)
				}
			}
			result, err := index.Search(context.Background(), "needle", SearchOptions{})
			if !errors.Is(err, ErrStaleIndex) || len(result.Hits) != 0 {
				t.Fatalf("stale result = %#v, %v", result, err)
			}
		})
	}
}

func TestLexicalReturnsVerifiedCurrentExcerpt(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/current.md": "# Current\n\nexact needle excerpt"})
	result, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hits) != 1 || result.Hits[0].Text != "exact needle excerpt" || len(result.Warnings) != 0 {
		t.Fatalf("current evidence = %#v", result)
	}
}

func TestLexicalRejectsSameByteFileReplacement(t *testing.T) {
	index, root := buildSearch(t, map[string]string{"wiki/replaced.md": "same needle bytes"})
	replaceSameBytes(t, filepath.Join(root, "wiki", "replaced.md"))
	result, err := index.Search(context.Background(), "needle", SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Hits) != 0 || !reflect.DeepEqual(result.Warnings, []Warning{{Path: "wiki/replaced.md", Code: WarningStaleIndex}}) {
		t.Fatalf("replacement accepted = %#v", result)
	}
}

func replaceSameBytes(t *testing.T, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	replacement := path + ".replacement"
	if err := os.WriteFile(replacement, raw, info.Mode().Perm()); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(replacement, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, path); err != nil {
		if removeErr := os.Remove(path); removeErr != nil {
			t.Fatal(removeErr)
		}
		if renameErr := os.Rename(replacement, path); renameErr != nil {
			t.Fatal(renameErr)
		}
	}
}

func TestLexicalCancellationPropagates(t *testing.T) {
	index, _ := buildSearch(t, map[string]string{"wiki/a.md": "alpha"})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := index.Search(ctx, "alpha", SearchOptions{}); err != context.Canceled {
		t.Fatalf("cancel = %v", err)
	}
	deadline, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	if _, err := index.Search(deadline, "alpha", SearchOptions{}); err != context.DeadlineExceeded {
		t.Fatalf("deadline = %v", err)
	}
}

func hitPaths(hits []Hit) []string {
	paths := make([]string, len(hits))
	for i, hit := range hits {
		paths[i] = hit.Path
	}
	return paths
}
