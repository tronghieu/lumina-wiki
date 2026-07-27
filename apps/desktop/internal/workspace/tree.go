package workspace

import (
	"context"
	"errors"
	"os"
	"sort"
	"strings"
)

const (
	MaxTreeDepth      = 16
	MaxTreeEntries    = 8192
	MaxTreeDirEntries = 512
	// MaxTreeScannedEntries bounds I/O and deterministic prefix selection CPU.
	MaxTreeScannedEntries = 4096
	MaxTreeNameBytes      = 255
	MaxTreePathBytes      = 4096
	MaxTreeWarnings       = 64
)

type TreeNode struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Path      string     `json:"path"`
	Kind      string     `json:"kind"`
	Size      int64      `json:"size,omitempty"`
	Children  []TreeNode `json:"children,omitempty"`
	Truncated bool       `json:"truncated,omitempty"`
}

type TreeWarning struct {
	Path string `json:"path"`
	Code string `json:"code"`
}
type WorkspaceTree struct {
	Nodes     []TreeNode    `json:"nodes"`
	Warnings  []TreeWarning `json:"warnings"`
	Truncated bool          `json:"truncated"`
}
type TreeBuilder struct {
	beforeOpen func(string)
	readDir    func(*os.File, string, int) ([]os.DirEntry, error)
}

func NewTreeBuilder() *TreeBuilder {
	return &TreeBuilder{readDir: func(file *os.File, _ string, count int) ([]os.DirEntry, error) { return file.ReadDir(count) }}
}

type treeState struct {
	tree    WorkspaceTree
	entries int
	err     error
}

func (builder *TreeBuilder) node(ctx context.Context, root *os.Root, path string, depth int, state *treeState) (TreeNode, bool) {
	if err := ctx.Err(); err != nil {
		state.err = err
		return TreeNode{}, false
	}
	name := path[strings.LastIndex(path, "/")+1:]
	info, err := treeLstat(root, path)
	if err != nil || strings.HasPrefix(name, ".") || len(name) > MaxTreeNameBytes {
		return TreeNode{}, false
	}
	if state.entries >= MaxTreeEntries {
		state.limit(path)
		return TreeNode{}, false
	}
	node := TreeNode{ID: treeID(path), Name: name, Path: path}
	if info.Mode().IsRegular() {
		node.Kind = "file"
		node.Size = info.Size()
		state.entries++
		return node, true
	}
	if !info.IsDir() {
		return TreeNode{}, false
	}
	node.Kind = "directory"
	node.Children = []TreeNode{}
	state.entries++
	if depth >= MaxTreeDepth || state.entries >= MaxTreeEntries {
		state.limit(path)
		node.Truncated = true
		return node, true
	}
	if builder.beforeOpen != nil {
		builder.beforeOpen(path)
	}
	directory, before, err := treeOpenStable(root, path, true)
	if err != nil {
		state.warn(path, "entry_changed")
		return TreeNode{}, false
	}
	entries, overflow, invalidEncoding, readErr := boundedTreeEntries(ctx, root, directory, path, builder.readDir)
	after, statErr := directory.Stat()
	_ = directory.Close()
	current, currentErr := treeLstat(root, path)
	if errors.Is(readErr, context.Canceled) || errors.Is(readErr, context.DeadlineExceeded) {
		state.err = readErr
		return TreeNode{}, false
	}
	if readErr != nil || statErr != nil || currentErr != nil || !os.SameFile(before, after) || !os.SameFile(before, current) || before.ModTime() != current.ModTime() {
		state.warn(path, "entry_changed")
		return TreeNode{}, false
	}
	if invalidEncoding {
		state.warn(path, "invalid_path_encoding")
	}
	for _, entry := range entries {
		if state.entries >= MaxTreeEntries {
			state.limit(path)
			node.Truncated = true
			break
		}
		childPath := path + "/" + entry.entry.Name()
		if len(childPath) > MaxTreePathBytes {
			state.warn(path, "limit_reached")
			continue
		}
		child, ok := builder.node(ctx, root, childPath, depth+1, state)
		if state.err != nil {
			return TreeNode{}, false
		}
		if ok {
			node.Children = append(node.Children, child)
		}
	}
	if overflow {
		state.limit(path)
		node.Truncated = true
	}
	sort.Slice(node.Children, func(i, j int) bool {
		left, right := node.Children[i], node.Children[j]
		if (left.Kind == "directory") != (right.Kind == "directory") {
			return left.Kind == "directory"
		}
		return left.Name < right.Name
	})
	return node, true
}

func (state *treeState) warn(path, code string) {
	for _, warning := range state.tree.Warnings {
		if warning.Path == path && warning.Code == code {
			return
		}
	}
	if len(state.tree.Warnings) < MaxTreeWarnings {
		state.tree.Warnings = append(state.tree.Warnings, TreeWarning{Path: path, Code: code})
	}
}
func (state *treeState) limit(path string) {
	state.tree.Truncated = true
	state.warn(path, "limit_reached")
}
