package graph

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadGraph(t *testing.T) {
	root := filepath.Join("..", "testdata", "lumina-workspace")
	service := NewService()

	graph, err := service.Load(root)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if len(graph.Nodes) != 5 {
		t.Fatalf("expected 5 nodes, got %d", len(graph.Nodes))
	}
	if len(graph.Edges) != 6 {
		t.Fatalf("expected 6 edges including citations, got %d", len(graph.Edges))
	}

	node := graph.Nodes[0]
	if node.ID == "" || node.Title == "" || node.Path == "" {
		t.Fatalf("node missing display fields: %#v", node)
	}
}

func TestLoadGraphRejectsMissingWiki(t *testing.T) {
	service := NewService()
	if _, err := service.Load(t.TempDir()); err == nil {
		t.Fatal("expected missing wiki error")
	}
}

func TestLoadGraphSkipsSymlinkedNotes(t *testing.T) {
	root := t.TempDir()
	conceptDir := filepath.Join(root, "wiki", "concepts")
	graphDir := filepath.Join(root, "wiki", "graph")
	if err := os.MkdirAll(conceptDir, 0o700); err != nil {
		t.Fatalf("create concepts dir: %v", err)
	}
	if err := os.MkdirAll(graphDir, 0o700); err != nil {
		t.Fatalf("create graph dir: %v", err)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("---\nid: outside\ntitle: Outside\n---\n"), 0o600); err != nil {
		t.Fatalf("write outside fixture: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(conceptDir, "outside.md")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	service := NewService()
	graph, err := service.Load(root)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if len(graph.Nodes) != 0 {
		t.Fatalf("expected symlinked note to be skipped, got %#v", graph.Nodes)
	}
}

func TestLoadGraphRejectsSymlinkedEdgeFile(t *testing.T) {
	root := t.TempDir()
	graphDir := filepath.Join(root, "wiki", "graph")
	if err := os.MkdirAll(filepath.Join(root, "wiki", "concepts"), 0o700); err != nil {
		t.Fatalf("create concepts dir: %v", err)
	}
	if err := os.MkdirAll(graphDir, 0o700); err != nil {
		t.Fatalf("create graph dir: %v", err)
	}
	outside := filepath.Join(t.TempDir(), "edges.jsonl")
	if err := os.WriteFile(outside, []byte(`{"from":"a","type":"related_to","to":"b"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write outside fixture: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(graphDir, "edges.jsonl")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	service := NewService()
	if _, err := service.Load(root); err == nil {
		t.Fatal("expected symlinked edge file to be rejected")
	}
}
