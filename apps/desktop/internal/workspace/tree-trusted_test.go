package workspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

type nilTreeFileInfo struct{}

func (*nilTreeFileInfo) Name() string       { return "" }
func (*nilTreeFileInfo) Size() int64        { return 0 }
func (*nilTreeFileInfo) Mode() os.FileMode  { return 0 }
func (*nilTreeFileInfo) ModTime() time.Time { return time.Time{} }
func (*nilTreeFileInfo) IsDir() bool        { return false }
func (*nilTreeFileInfo) Sys() any           { return nil }

func TestBuildTrustedMatchesNormalTree(t *testing.T) {
	root := makeTreeWorkspace(t)
	proof, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	builder := NewTreeBuilder()
	normal, err := builder.Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	trusted, err := builder.BuildTrusted(context.Background(), root, proof)
	if err != nil || !reflect.DeepEqual(trusted, normal) {
		t.Fatalf("trusted=%+v err=%v", trusted, err)
	}
}

func TestBuildTrustedRejectsInvalidProofWithoutTree(t *testing.T) {
	root := makeTreeWorkspace(t)
	fileProof, err := os.Stat(filepath.Join(root, "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	var typedNil *nilTreeFileInfo
	for name, proof := range map[string]os.FileInfo{"nil": nil, "typed nil": typedNil, "file": fileProof} {
		t.Run(name, func(t *testing.T) {
			tree, err := NewTreeBuilder().BuildTrusted(context.Background(), root, proof)
			if !errors.Is(err, ErrTrustedTreeUnavailable) || !reflect.DeepEqual(tree, WorkspaceTree{}) {
				t.Fatalf("tree=%+v err=%v", tree, err)
			}
		})
	}
}

func TestBuildTrustedRejectsRootReplacementBeforeAndDuringScan(t *testing.T) {
	for _, timing := range []string{"before", "during"} {
		t.Run(timing, func(t *testing.T) {
			root := makeTreeWorkspace(t)
			proof, err := os.Stat(root)
			if err != nil {
				t.Fatal(err)
			}
			builder := NewTreeBuilder()
			replace := func() {
				if err := os.Rename(root, root+"-old"); err != nil {
					t.Fatal(err)
				}
				if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("replacement"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if timing == "before" {
				replace()
			} else {
				builder.beforeOpen = func(string) { builder.beforeOpen = nil; replace() }
			}
			tree, err := builder.BuildTrusted(context.Background(), root, proof)
			if !errors.Is(err, ErrTrustedTreeUnavailable) || !reflect.DeepEqual(tree, WorkspaceTree{}) {
				t.Fatalf("tree=%+v err=%v", tree, err)
			}
		})
	}
}
