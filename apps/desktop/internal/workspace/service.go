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
	abs, err := filepath.Abs(root)
	if err != nil {
		return ValidationResult{}, err
	}
	required := []string{"README.md", "wiki"}
	for _, item := range required {
		info, err := os.Stat(filepath.Join(abs, item))
		if err != nil {
			return ValidationResult{Root: abs, Valid: false}, errors.New("not a Lumina workspace")
		}
		if item == "README.md" && info.IsDir() {
			return ValidationResult{Root: abs, Valid: false}, errors.New("not a Lumina workspace")
		}
		if item == "wiki" && !info.IsDir() {
			return ValidationResult{Root: abs, Valid: false}, errors.New("not a Lumina workspace")
		}
	}
	return ValidationResult{Root: abs, Valid: true, Packs: detectPacks(abs)}, nil
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

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
