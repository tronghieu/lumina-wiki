package workspace

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"reflect"
)

var ErrTrustedTreeUnavailable = errors.New("trusted workspace tree unavailable")

// Build accepts a canonical root previously authorized by the backend. Its
// validation is defense in depth, not an authorization decision.
func (builder *TreeBuilder) Build(ctx context.Context, rootPath string) (WorkspaceTree, error) {
	return builder.build(ctx, rootPath, nil)
}

func (builder *TreeBuilder) BuildTrusted(ctx context.Context, rootPath string, expected os.FileInfo) (WorkspaceTree, error) {
	if ctx == nil {
		return WorkspaceTree{}, ErrTrustedTreeUnavailable
	}
	if err := ctx.Err(); err != nil {
		return WorkspaceTree{}, err
	}
	if invalidTreeProof(expected) {
		return WorkspaceTree{}, ErrTrustedTreeUnavailable
	}
	tree, err := builder.build(ctx, rootPath, expected)
	if err == nil {
		return tree, nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return WorkspaceTree{}, err
	}
	return WorkspaceTree{}, ErrTrustedTreeUnavailable
}

func (builder *TreeBuilder) build(ctx context.Context, rootPath string, expected os.FileInfo) (WorkspaceTree, error) {
	if ctx == nil {
		return WorkspaceTree{}, errors.New("workspace tree context is invalid")
	}
	if err := ctx.Err(); err != nil {
		return WorkspaceTree{}, err
	}
	var root *os.Root
	var err error
	if expected == nil {
		root, err = openTreeWorkspace(rootPath)
	} else {
		root, err = openTrustedTreeWorkspace(rootPath, expected)
	}
	if err != nil {
		return WorkspaceTree{}, err
	}
	defer root.Close()
	state := treeState{tree: WorkspaceTree{Nodes: []TreeNode{}, Warnings: []TreeWarning{}}}
	for _, name := range []string{"_lumina", "raw", "wiki"} {
		if state.entries >= MaxTreeEntries {
			state.limit(name)
			break
		}
		if err := ctx.Err(); err != nil {
			return WorkspaceTree{}, err
		}
		info, err := root.Lstat(name)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil || info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
			continue
		}
		node, ok := builder.node(ctx, root, name, 0, &state)
		if state.err != nil {
			return WorkspaceTree{}, state.err
		}
		if ok {
			state.tree.Nodes = append(state.tree.Nodes, node)
		}
	}
	if !treeRootCurrent(root) {
		return WorkspaceTree{}, errors.New("workspace root changed")
	}
	return state.tree, nil
}

func invalidTreeProof(expected os.FileInfo) bool {
	if expected == nil {
		return true
	}
	value := reflect.ValueOf(expected)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		if value.IsNil() {
			return true
		}
	}
	return !expected.IsDir()
}
