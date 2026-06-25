package importer

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	desktopworkspace "github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

type ImportResult struct {
	Source       string `json:"source"`
	Destination  string `json:"destination"`
	RelativePath string `json:"relativePath"`
	Bytes        int64  `json:"bytes"`
}

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) ImportToRawSources(root, sourcePath string) (ImportResult, error) {
	info, err := os.Lstat(sourcePath)
	if err != nil {
		return ImportResult{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return ImportResult{}, errors.New("source file symlinks are not allowed")
	}
	if !info.Mode().IsRegular() {
		return ImportResult{}, errors.New("source must be a regular file")
	}

	workspaceService := desktopworkspace.NewService()
	validation, err := workspaceService.Validate(root)
	if err != nil {
		return ImportResult{}, err
	}

	name := filepath.Base(sourcePath)
	destinationDir, err := workspaceService.ResolveInside(validation.Root, filepath.Join("raw", "sources"))
	if err != nil {
		return ImportResult{}, err
	}
	if err := os.MkdirAll(destinationDir, 0o700); err != nil {
		return ImportResult{}, err
	}
	destinationDir, err = desktopworkspace.ResolveExisting(validation.Root, filepath.Join("raw", "sources"))
	if err != nil {
		return ImportResult{}, err
	}
	destinationInfo, err := os.Lstat(destinationDir)
	if err != nil || !destinationInfo.IsDir() {
		return ImportResult{}, errors.New("raw sources must be a real directory")
	}
	destination, err := workspaceService.ResolveInside(validation.Root, filepath.Join("raw", "sources", name))
	if err != nil {
		return ImportResult{}, err
	}

	source, err := os.Open(sourcePath)
	if err != nil {
		return ImportResult{}, err
	}
	defer source.Close()

	target, err := os.CreateTemp(destinationDir, ".lumina-import-*")
	if err != nil {
		return ImportResult{}, err
	}
	success := false
	defer func() {
		_ = target.Close()
		if !success {
			_ = os.Remove(target.Name())
		}
	}()

	written, err := io.Copy(target, source)
	if err != nil {
		return ImportResult{}, err
	}
	if err := target.Sync(); err != nil {
		return ImportResult{}, err
	}
	if err := target.Close(); err != nil {
		return ImportResult{}, err
	}
	if err := os.Link(target.Name(), destination); err != nil {
		if errors.Is(err, os.ErrExist) {
			return ImportResult{}, errors.New("raw source already exists")
		}
		return ImportResult{}, err
	}
	if err := os.Remove(target.Name()); err != nil {
		_ = os.Remove(destination)
		return ImportResult{}, err
	}
	success = true
	return ImportResult{
		Source:       sourcePath,
		Destination:  destination,
		RelativePath: filepath.ToSlash(filepath.Join("raw", "sources", name)),
		Bytes:        written,
	}, nil
}
