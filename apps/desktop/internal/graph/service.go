package graph

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	desktopworkspace "github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) Load(root string) (Graph, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return Graph{}, err
	}
	wikiRoot := filepath.Join(absRoot, "wiki")
	if info, err := os.Stat(wikiRoot); err != nil || !info.IsDir() {
		return Graph{}, errors.New("workspace wiki directory not found")
	}
	nodes, err := loadNodes(wikiRoot)
	if err != nil {
		return Graph{}, err
	}
	edges, err := loadEdges(filepath.Join(wikiRoot, "graph"))
	if err != nil {
		return Graph{}, err
	}
	return Graph{Nodes: nodes, Edges: edges}, nil
}

func (s *Service) ReadNote(root, notePath string) (NoteContent, error) {
	if filepath.IsAbs(notePath) {
		return NoteContent{}, errors.New("absolute note paths are not allowed")
	}
	if strings.Contains(notePath, `\`) {
		return NoteContent{}, errors.New("backslash note paths are not allowed")
	}
	if !strings.HasSuffix(notePath, ".md") {
		return NoteContent{}, errors.New("only markdown notes can be read")
	}
	if !isEntityNotePath(notePath) {
		return NoteContent{}, errors.New("note path is not a wiki entity note")
	}

	workspaceService := desktopworkspace.NewService()
	validation, err := workspaceService.Validate(root)
	if err != nil {
		return NoteContent{}, err
	}
	wikiRoot, err := workspaceService.ResolveInside(validation.Root, "wiki")
	if err != nil {
		return NoteContent{}, err
	}
	path, err := workspaceService.ResolveInside(wikiRoot, notePath)
	if err != nil {
		return NoteContent{}, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return NoteContent{}, err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return NoteContent{}, errors.New("note symlinks are not allowed")
	}
	if !info.Mode().IsRegular() {
		return NoteContent{}, errors.New("note must be a regular file")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return NoteContent{}, err
	}
	return NoteContent{Path: filepath.ToSlash(notePath), Content: string(content)}, nil
}

func isEntityNotePath(notePath string) bool {
	clean := filepath.ToSlash(filepath.Clean(notePath))
	if clean != notePath || clean == "." || strings.HasPrefix(clean, "../") {
		return false
	}
	dir, _, ok := strings.Cut(clean, "/")
	if !ok {
		return false
	}
	for _, entityDir := range entityDirs() {
		if dir == entityDir {
			return true
		}
	}
	return false
}

func loadNodes(wikiRoot string) ([]Node, error) {
	var nodes []Node
	for _, dir := range entityDirs() {
		base := filepath.Join(wikiRoot, dir)
		err := filepath.WalkDir(base, func(path string, entry os.DirEntry, err error) error {
			if err != nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
				return err
			}
			if entry.Type()&fs.ModeSymlink != 0 {
				return nil
			}
			rel, err := filepath.Rel(wikiRoot, path)
			if err != nil {
				return err
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			nodes = append(nodes, parseMarkdownNote(filepath.ToSlash(rel), raw))
			return nil
		})
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	return nodes, nil
}

func entityDirs() []string {
	return []string{
		"sources", "concepts", "people", "summary", "outputs",
		"foundations", "topics",
		"chapters", "characters", "themes", "plot",
	}
}

func loadEdges(graphRoot string) ([]Edge, error) {
	var edges []Edge
	for _, name := range []string{"edges.jsonl", "citations.jsonl"} {
		fileEdges, err := readEdgeFile(filepath.Join(graphRoot, name))
		if err != nil {
			return nil, err
		}
		edges = append(edges, fileEdges...)
	}
	sort.Slice(edges, func(i, j int) bool {
		return edges[i].From+edges[i].Type+edges[i].To < edges[j].From+edges[j].Type+edges[j].To
	})
	return edges, nil
}

func readEdgeFile(path string) ([]Edge, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return nil, errors.New("graph edge files must be regular files")
	}
	if !info.Mode().IsRegular() {
		return nil, nil
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var edges []Edge
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var edge Edge
		if err := json.Unmarshal([]byte(line), &edge); err != nil {
			return nil, err
		}
		edges = append(edges, edge)
	}
	return edges, scanner.Err()
}
