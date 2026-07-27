package workspace

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
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
	abs, err := filepath.Abs(root)
	if err != nil {
		return ValidationResult{}, err
	}
	rootHandle, err := openTreeRoot(abs)
	if err != nil {
		return ValidationResult{Root: abs, Valid: false}, errors.New("not a Lumina workspace")
	}
	defer rootHandle.Close()
	return validateServiceRoot(context.Background(), abs, rootHandle)
}

func (s *Service) ValidateTrusted(ctx context.Context, root string, proof rootproof.RootProof) (ValidationResult, error) {
	if err := ctx.Err(); err != nil {
		return ValidationResult{}, err
	}
	if root == "" || filepath.Clean(root) != root || proof.Path() != root {
		return ValidationResult{}, errors.New("trusted workspace is unavailable")
	}
	if err := proof.Validate(); err != nil {
		return ValidationResult{}, errors.New("trusted workspace is unavailable")
	}
	reopenedProof, err := rootproof.Open(root)
	if err != nil {
		return ValidationResult{}, errors.New("trusted workspace is unavailable")
	}
	defer reopenedProof.Close()
	expectedSignature, expectedOK := proof.Signature()
	openedSignature, openedOK := reopenedProof.Signature()
	if !expectedOK || !openedOK || expectedSignature != openedSignature {
		return ValidationResult{}, errors.New("trusted workspace is unavailable")
	}
	rootHandle, err := proof.OpenRoot()
	if err != nil {
		return ValidationResult{}, errors.New("trusted workspace is unavailable")
	}
	defer rootHandle.Close()
	result, err := validateServiceRoot(ctx, root, rootHandle)
	if err != nil || proof.Validate() != nil || reopenedProof.Validate() != nil {
		return ValidationResult{}, errors.New("trusted workspace is unavailable")
	}
	return result, nil
}

func validateServiceRoot(ctx context.Context, path string, root *os.Root) (ValidationResult, error) {
	if err := validateTreeWorkspace(root); err != nil {
		return ValidationResult{Root: path, Valid: false}, errors.New("not a Lumina workspace")
	}
	status, err := inspectManifest(ctx, root)
	if err != nil {
		return ValidationResult{}, err
	}
	if status == manifestMalformed || status == manifestNewer {
		return ValidationResult{Root: path, Valid: false}, errors.New("not a compatible Lumina workspace")
	}
	return ValidationResult{Root: path, Valid: true, Packs: detectPacksRoot(root)}, nil
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
	if filepath.IsAbs(fragment) {
		return "", errors.New("absolute paths are not allowed")
	}
	if strings.Contains(fragment, `\`) {
		return "", errors.New("backslash paths are not allowed")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	candidate := filepath.Clean(filepath.Join(absRoot, fragment))
	rel, err := filepath.Rel(absRoot, candidate)
	if err != nil {
		return "", err
	}
	if rel == "." || rel == "" {
		return candidate, nil
	}
	if strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return "", errors.New("path escapes workspace")
	}
	return candidate, nil
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

func detectPacksRoot(root *os.Root) []string {
	packs := []string{"core"}
	if rootedDirectoryExists(root, "wiki/topics") || rootedDirectoryExists(root, "wiki/foundations") {
		packs = append(packs, "research")
	}
	if rootedDirectoryExists(root, "wiki/chapters") || rootedDirectoryExists(root, "wiki/characters") {
		packs = append(packs, "reading")
	}
	return packs
}

func rootedDirectoryExists(root *os.Root, name string) bool {
	info, err := root.Lstat(name)
	return err == nil && info.Mode()&fs.ModeSymlink == 0 && info.IsDir()
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
