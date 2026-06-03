package workspace

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

type WorkspaceSummary struct {
	Root                   string   `json:"root"`
	Valid                  bool     `json:"valid"`
	Packs                  []string `json:"packs"`
	WikiNotes              int      `json:"wikiNotes"`
	RawSources             int      `json:"rawSources"`
	RawNotes               int      `json:"rawNotes"`
	GraphEdges             int      `json:"graphEdges"`
	GraphCitations         int      `json:"graphCitations"`
	MissingExpectedFolders []string `json:"missingExpectedFolders"`
}

func missingExpectedFolders(root string) []string {
	expected := []string{"raw", "raw/sources", "raw/notes", "wiki/graph"}
	missing := []string{}
	for _, fragment := range expected {
		if !isRealDirPath(root, fragment) {
			missing = append(missing, fragment)
		}
	}
	return missing
}

func countMarkdownNotes(root string) int {
	count := 0
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if entry.Name() == "graph" && path != root {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return nil
		}
		name := entry.Name()
		if name == "index.md" || name == "log.md" || filepath.Ext(name) != ".md" {
			return nil
		}
		count++
		return nil
	})
	return count
}

func countMarkdownNotesInside(root, fragment string) int {
	if !isRealDirPath(root, fragment) {
		return 0
	}
	return countMarkdownNotes(filepath.Join(root, filepath.FromSlash(fragment)))
}

func countRegularFilesInside(root, fragment string) int {
	if !isRealDirPath(root, fragment) {
		return 0
	}
	return countRegularFiles(filepath.Join(root, filepath.FromSlash(fragment)))
}

func countRegularFiles(root string) int {
	count := 0
	_ = filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return nil
		}
		count++
		return nil
	})
	return count
}

func countNonEmptyLinesInside(root, fragment string) int {
	dir := filepath.ToSlash(filepath.Dir(fragment))
	if !isRealDirPath(root, dir) {
		return 0
	}
	return countNonEmptyLines(filepath.Join(root, filepath.FromSlash(fragment)))
}

func countNonEmptyLines(path string) int {
	if !isRealRegularFile(path) {
		return 0
	}
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer file.Close()
	count := 0
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) != "" {
			count++
		}
	}
	return count
}

func isRealDirPath(root, fragment string) bool {
	current := root
	for _, part := range strings.Split(filepath.ToSlash(fragment), "/") {
		if part == "" {
			continue
		}
		current = filepath.Join(current, part)
		if !isRealDir(current) {
			return false
		}
	}
	return true
}

func isRealDir(path string) bool {
	info, err := os.Lstat(path)
	if err != nil {
		return false
	}
	return info.IsDir() && info.Mode()&os.ModeSymlink == 0
}

func isRealRegularFile(path string) bool {
	info, err := os.Lstat(path)
	if err != nil {
		return false
	}
	return info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0
}
