package ai

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

func treeNode(id, name, path, kind string, size int64, children ...workspace.TreeNode) workspace.TreeNode {
	return workspace.TreeNode{ID: id, Name: name, Path: path, Kind: kind, Size: size, Children: children}
}

func TestWorkspaceTreeDTORejectsMalformedHierarchyAndShape(t *testing.T) {
	const idA = "node_00000000000000000000000000000000"
	const idB = "node_11111111111111111111111111111111"
	const idC = "node_22222222222222222222222222222222"
	invalid := map[string]workspace.WorkspaceTree{
		"lumina file root":  {Nodes: []workspace.TreeNode{treeNode(idA, "_lumina", "_lumina", "file", 1)}},
		"raw file root":     {Nodes: []workspace.TreeNode{treeNode(idA, "raw", "raw", "file", 1)}},
		"wiki file root":    {Nodes: []workspace.TreeNode{treeNode(idA, "wiki", "wiki", "file", 1)}},
		"nested top level":  {Nodes: []workspace.TreeNode{treeNode(idA, "nested", "wiki/nested", "directory", 0)}},
		"cross root child":  {Nodes: []workspace.TreeNode{treeNode(idA, "wiki", "wiki", "directory", 0, treeNode(idB, "raw", "raw", "directory", 0))}},
		"duplicate id":      {Nodes: []workspace.TreeNode{treeNode(idA, "wiki", "wiki", "directory", 0), treeNode(idA, "raw", "raw", "directory", 0)}},
		"duplicate path":    {Nodes: []workspace.TreeNode{treeNode(idA, "wiki", "wiki", "directory", 0), treeNode(idB, "wiki", "wiki", "directory", 0)}},
		"sibling collision": {Nodes: []workspace.TreeNode{treeNode(idA, "wiki", "wiki", "directory", 0, treeNode(idB, "same", "wiki/same", "directory", 0), treeNode(idC, "same", "wiki/same", "directory", 0))}},
		"directory size":    {Nodes: []workspace.TreeNode{treeNode(idA, "wiki", "wiki", "directory", 1)}},
		"file child":        {Nodes: []workspace.TreeNode{treeNode(idA, "wiki", "wiki", "file", 1, treeNode(idB, "note", "wiki/note", "file", 1))}},
		"negative file":     {Nodes: []workspace.TreeNode{treeNode(idA, "wiki", "wiki", "directory", 0, treeNode(idB, "note", "wiki/note", "file", -1))}},
	}
	for name, tree := range invalid {
		t.Run(name, func(t *testing.T) {
			if _, err := workspaceTreeDTO(tree); err == nil {
				t.Fatalf("accepted %+v", tree)
			}
		})
	}
}

func TestWorkspaceTreeDTOAcceptsRealTrustedTree(t *testing.T) {
	root := managementWorkspace(t)
	if err := os.MkdirAll(filepath.Join(root, "raw"), 0o700); err != nil {
		t.Fatal(err)
	}
	proof, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	tree, err := workspace.NewTreeBuilder().BuildTrusted(context.Background(), root, proof)
	if err != nil {
		t.Fatal(err)
	}
	dto, err := workspaceTreeDTO(tree)
	if err != nil || len(dto.Nodes) == 0 {
		t.Fatalf("dto=%+v err=%v", dto, err)
	}
}
