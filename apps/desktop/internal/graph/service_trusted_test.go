package graph

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadNoteTrustedUsesPinnedRootAndPathlessLocator(t *testing.T) {
	root := t.TempDir()
	note := filepath.Join(root, "wiki", "concepts", "trusted.md")
	if err := os.MkdirAll(filepath.Dir(note), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(note, []byte("trusted content"), 0o600); err != nil {
		t.Fatal(err)
	}
	proof, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewService().ReadNoteTrusted(
		context.Background(),
		root,
		proof,
		"wiki/concepts/trusted.md",
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != "wiki/concepts/trusted.md" || result.Content != "trusted content" {
		t.Fatalf("result = %#v", result)
	}
}

func TestReadNoteTrustedRejectsUnsafeLocatorSymlinkOversizeAndReplacedRoot(t *testing.T) {
	root := t.TempDir()
	noteDir := filepath.Join(root, "wiki", "concepts")
	if err := os.MkdirAll(noteDir, 0o700); err != nil {
		t.Fatal(err)
	}
	proof, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService()
	for _, locator := range []string{
		"",
		"/wiki/concepts/note.md",
		`wiki\concepts\note.md`,
		"wiki/../raw/note.md",
		"raw/note.md",
		"wiki/concepts/note.txt",
		"wiki/unsupported/note.md",
	} {
		if _, err := service.ReadNoteTrusted(context.Background(), root, proof, locator); err == nil {
			t.Fatalf("accepted unsafe locator %q", locator)
		}
	}

	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(noteDir, "link.md")); err == nil {
		if _, err := service.ReadNoteTrusted(
			context.Background(), root, proof, "wiki/concepts/link.md",
		); err == nil {
			t.Fatal("accepted symlink note")
		}
	}

	large := filepath.Join(noteDir, "large.md")
	if err := os.WriteFile(large, []byte(strings.Repeat("x", MaxTrustedNoteBytes+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReadNoteTrusted(
		context.Background(), root, proof, "wiki/concepts/large.md",
	); !errors.Is(err, ErrTrustedNoteUnavailable) {
		t.Fatalf("oversized note = %v", err)
	}

	replacement := root + "-replacement"
	if err := os.Rename(root, replacement); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "wiki", "concepts"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(root, "wiki", "concepts", "trusted.md"),
		[]byte("replacement"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReadNoteTrusted(
		context.Background(), root, proof, "wiki/concepts/trusted.md",
	); !errors.Is(err, ErrTrustedNoteUnavailable) {
		t.Fatalf("replaced root = %v", err)
	}
}

func TestReadNoteTrustedRejectsLeafReplacementBetweenProofAndOpen(t *testing.T) {
	root := t.TempDir()
	noteDir := filepath.Join(root, "wiki", "concepts")
	if err := os.MkdirAll(noteDir, 0o700); err != nil {
		t.Fatal(err)
	}
	note := filepath.Join(noteDir, "trusted.md")
	other := filepath.Join(noteDir, "other.md")
	if err := os.WriteFile(note, []byte("trusted content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(other, []byte("different in-root content"), 0o600); err != nil {
		t.Fatal(err)
	}
	proof, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService()
	service.beforeTrustedNoteOpen = func() {
		service.beforeTrustedNoteOpen = func() {}
		if err := os.Rename(note, note+".original"); err != nil {
			t.Fatalf("move checked note: %v", err)
		}
		if err := os.Symlink("other.md", note); err != nil {
			t.Fatalf("replace checked note with symlink: %v", err)
		}
	}
	if _, err := service.ReadNoteTrusted(
		context.Background(), root, proof, "wiki/concepts/trusted.md",
	); !errors.Is(err, ErrTrustedNoteUnavailable) {
		t.Fatalf("replaced note error = %v, want ErrTrustedNoteUnavailable", err)
	}
}
