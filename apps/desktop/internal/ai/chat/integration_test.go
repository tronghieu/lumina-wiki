package chat

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func byteManifest(t *testing.T, root string) map[string]string {
	t.Helper()
	manifest := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		manifest[filepath.ToSlash(relative)] = string(raw)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return manifest
}

func TestWorkspaceSearchAllowlistContextExtractAndBroadReadIsReadOnly(t *testing.T) {
	index, root := testIndex(t, map[string]string{"wiki/custom-folder/topic.md": "# Topic\n\nA grounded needle statement.\n\nMore broad-note detail."})
	before := byteManifest(t, root)
	search, err := index.Search(context.Background(), "needle", retrieval.SearchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	allowlist, err := NewEvidenceAllowlist(context.Background(), index, search.Hits,
		retrieval.CitationOptions{Random: bytes.NewReader(bytes.Repeat([]byte{0x5c}, 16))})
	if err != nil {
		t.Fatal(err)
	}
	defer allowlist.Close()
	built, err := (ContextBuilder{}).Build(BuildInput{Profile: chatProfile(), Question: "What is grounded?", Evidence: allowlist})
	if err != nil {
		t.Fatal(err)
	}
	if built.EvidenceIncluded != 1 {
		t.Fatalf("context = %#v", built)
	}
	extracted, err := allowlist.Extract("It is grounded [S1].")
	if err != nil || len(extracted.Citations) != 1 {
		t.Fatalf("extract = %#v %v", extracted, err)
	}
	note, err := allowlist.ReadCitationNote(context.Background(), extracted.Citations[0].CitationID)
	if err != nil {
		t.Fatal(err)
	}
	if note.Path != "wiki/custom-folder/topic.md" || note.Content != "# Topic\n\nA grounded needle statement.\n\nMore broad-note detail." {
		t.Fatalf("broad note = %#v", note)
	}
	after := byteManifest(t, root)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("workspace changed: before=%#v after=%#v", before, after)
	}
}
