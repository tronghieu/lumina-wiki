package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type ValidationResult struct {
	Root  string   `json:"root"`
	Valid bool     `json:"valid"`
	Packs []string `json:"packs"`
}

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) Validate(root string) (ValidationResult, error) {
	realRoot, err := canonicalRoot(root)
	if err != nil {
		return ValidationResult{}, errors.New("not a Lumina workspace")
	}

	readme, err := ResolveExisting(realRoot, "README.md")
	if err != nil {
		return ValidationResult{Root: realRoot, Valid: false}, errors.New("not a Lumina workspace")
	}
	readmeInfo, err := os.Lstat(readme)
	if err != nil || !readmeInfo.Mode().IsRegular() {
		return ValidationResult{Root: realRoot, Valid: false}, errors.New("not a Lumina workspace")
	}

	wiki, err := ResolveExisting(realRoot, "wiki")
	if err != nil {
		return ValidationResult{Root: realRoot, Valid: false}, errors.New("not a Lumina workspace")
	}
	wikiInfo, err := os.Lstat(wiki)
	if err != nil || !wikiInfo.IsDir() {
		return ValidationResult{Root: realRoot, Valid: false}, errors.New("not a Lumina workspace")
	}

	return ValidationResult{Root: realRoot, Valid: true, Packs: detectPacks(realRoot)}, nil
}

func (s *Service) Summary(root string) (WorkspaceSummary, error) {
	validation, err := s.Validate(root)
	if err != nil {
		return WorkspaceSummary{}, err
	}
	summary := WorkspaceSummary{
		Root:  validation.Root,
		Valid: validation.Valid,
		Packs: validation.Packs,
	}
	summary.MissingExpectedFolders = missingExpectedFolders(validation.Root)
	summary.WikiNotes = countMarkdownNotesInside(validation.Root, "wiki")
	summary.RawSources = countRegularFilesInside(validation.Root, "raw/sources")
	summary.RawNotes = countRegularFilesInside(validation.Root, "raw/notes")
	summary.GraphEdges = countNonEmptyLinesInside(validation.Root, "wiki/graph/edges.jsonl")
	summary.GraphCitations = countNonEmptyLinesInside(validation.Root, "wiki/graph/citations.jsonl")
	return summary, nil
}

func (s *Service) ResolveInside(root, fragment string) (string, error) {
	if filepath.IsAbs(fragment) || filepath.VolumeName(fragment) != "" {
		return "", errors.New("absolute paths are not allowed")
	}
	if strings.Contains(fragment, `\`) {
		return "", errors.New("backslash paths are not allowed")
	}
	realRoot, err := canonicalRoot(root)
	if err != nil {
		return "", err
	}
	cleanFragment := filepath.Clean(fragment)
	if cleanFragment == "." && fragment != "." && fragment != "" {
		return "", errors.New("invalid path fragment")
	}
	candidate := filepath.Clean(filepath.Join(realRoot, cleanFragment))
	rel, err := filepath.Rel(realRoot, candidate)
	if err != nil {
		return "", err
	}
	if rel == "." || rel == "" {
		return candidate, nil
	}
	if strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return "", errors.New("path escapes workspace")
	}

	current := realRoot
	parts := strings.Split(rel, string(filepath.Separator))
	for index, part := range parts {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if errors.Is(statErr, os.ErrNotExist) {
			break
		}
		if statErr != nil {
			return "", statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("symlink paths are not allowed")
		}
		if index < len(parts)-1 && !info.IsDir() {
			return "", errors.New("path parent is not a directory")
		}
	}
	return candidate, nil
}

func ResolveExisting(root, fragment string) (string, error) {
	path, err := NewService().ResolveInside(root, fragment)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(path); err != nil {
		return "", err
	}
	return path, nil
}

func canonicalRoot(root string) (string, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	realRoot, err := filepath.EvalSymlinks(absRoot)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(realRoot)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("workspace root must be a real directory")
	}
	return realRoot, nil
}

func detectPacks(root string) []string {
	packs := []string{"core"}
	if exists(filepath.Join(root, "wiki", "topics")) || exists(filepath.Join(root, "wiki", "foundations")) {
		packs = append(packs, "research")
	}
	if exists(filepath.Join(root, "wiki", "chapters")) || exists(filepath.Join(root, "wiki", "characters")) {
		packs = append(packs, "reading")
	}
	return packs
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
