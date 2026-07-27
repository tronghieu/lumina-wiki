package workspace

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

type syntheticDirEntry struct{ name string }

func (entry syntheticDirEntry) Name() string         { return entry.name }
func (syntheticDirEntry) IsDir() bool                { return false }
func (syntheticDirEntry) Type() fs.FileMode          { return 0 }
func (syntheticDirEntry) Info() (fs.FileInfo, error) { return nil, fs.ErrNotExist }

func TestTreeDirectoryScanHasHardEntryAndReadCallCeilings(t *testing.T) {
	root := makeTreeWorkspace(t)
	builder := NewTreeBuilder()
	defaultRead := builder.readDir
	readCalls, returned := 0, 0
	builder.readDir = func(file *os.File, path string, count int) ([]os.DirEntry, error) {
		if path != "wiki/concepts" {
			return defaultRead(file, path, count)
		}
		readCalls++
		entries := make([]os.DirEntry, count)
		for index := range entries {
			entries[index] = syntheticDirEntry{name: fmt.Sprintf("synthetic-%06d", returned+index)}
		}
		returned += len(entries)
		return entries, nil
	}
	tree, err := builder.Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if returned != MaxTreeScannedEntries+1 {
		t.Fatalf("scanned entries = %d", returned)
	}
	wantCalls := (MaxTreeScannedEntries+treeScanBatchSize-1)/treeScanBatchSize + 1
	if readCalls != wantCalls {
		t.Fatalf("read calls = %d, want %d", readCalls, wantCalls)
	}
	if !tree.Truncated {
		t.Fatal("scan ceiling was not reported")
	}
}

func TestExactScanCeilingWithoutEligibleOverflowIsNotTruncated(t *testing.T) {
	root := makeTreeWorkspace(t)
	builder := NewTreeBuilder()
	defaultRead := builder.readDir
	readCalls, returned := 0, 0
	builder.readDir = func(file *os.File, path string, count int) ([]os.DirEntry, error) {
		if path != "wiki/concepts" {
			return defaultRead(file, path, count)
		}
		readCalls++
		if returned == MaxTreeScannedEntries {
			return nil, io.EOF
		}
		entries := make([]os.DirEntry, count)
		for index := range entries {
			entries[index] = syntheticDirEntry{name: fmt.Sprintf("missing-%06d", returned+index)}
		}
		returned += len(entries)
		return entries, nil
	}
	tree, err := builder.Build(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if returned != MaxTreeScannedEntries || readCalls != 17 {
		t.Fatalf("reads=%d entries=%d", readCalls, returned)
	}
	if tree.Truncated {
		t.Fatal("exact scan ceiling falsely reported truncation")
	}
}

func TestOverScanCeilingDiscardsOrderDependentCandidates(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		t.Run(fmt.Sprintf("reverse-%t", reverse), func(t *testing.T) {
			root := makeTreeWorkspace(t)
			for _, name := range []string{"a.md", "z.md"} {
				if err := os.WriteFile(filepath.Join(root, "wiki", "concepts", name), []byte(name), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			builder := NewTreeBuilder()
			defaultRead := builder.readDir
			index := 0
			builder.readDir = func(file *os.File, path string, count int) ([]os.DirEntry, error) {
				if path != "wiki/concepts" {
					return defaultRead(file, path, count)
				}
				entries := make([]os.DirEntry, count)
				for i := range entries {
					name := "a.md"
					if ((index+i)%2 == 0) == reverse {
						name = "z.md"
					}
					entries[i] = syntheticDirEntry{name: name}
				}
				index += count
				return entries, nil
			}
			tree, err := builder.Build(context.Background(), root)
			if err != nil {
				t.Fatal(err)
			}
			concepts := findTreeNode(tree.Nodes, "wiki/concepts")
			if concepts == nil || len(concepts.Children) != 0 || !concepts.Truncated || !tree.Truncated {
				t.Fatalf("order-dependent result: %#v", concepts)
			}
		})
	}
}

func TestTreePropagatesDeadlineExceededFromDirectoryRead(t *testing.T) {
	root := makeTreeWorkspace(t)
	builder := NewTreeBuilder()
	defaultRead := builder.readDir
	builder.readDir = func(file *os.File, path string, count int) ([]os.DirEntry, error) {
		if path == "wiki/concepts" {
			return nil, context.DeadlineExceeded
		}
		return defaultRead(file, path, count)
	}
	_, err := builder.Build(context.Background(), root)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline = %v", err)
	}
}

func TestTreeDirectoryScanStopsOnMidScanCancellation(t *testing.T) {
	root := makeTreeWorkspace(t)
	ctx, cancel := context.WithCancel(context.Background())
	builder := NewTreeBuilder()
	defaultRead := builder.readDir
	readCalls, returned := 0, 0
	builder.readDir = func(file *os.File, path string, count int) ([]os.DirEntry, error) {
		if path != "wiki/concepts" {
			return defaultRead(file, path, count)
		}
		readCalls++
		entries := make([]os.DirEntry, count)
		for index := range entries {
			entries[index] = syntheticDirEntry{name: fmt.Sprintf("cancel-%06d", returned+index)}
		}
		returned += len(entries)
		if readCalls == 2 {
			cancel()
		}
		return entries, nil
	}
	if _, err := builder.Build(ctx, root); err != context.Canceled {
		t.Fatalf("cancellation = %v", err)
	}
	if readCalls != 2 || returned > 2*treeScanBatchSize {
		t.Fatalf("continued after cancellation: calls=%d entries=%d", readCalls, returned)
	}
}

func findTreeNode(nodes []TreeNode, path string) *TreeNode {
	for index := range nodes {
		if nodes[index].Path == path {
			return &nodes[index]
		}
		if found := findTreeNode(nodes[index].Children, path); found != nil {
			return found
		}
	}
	return nil
}
