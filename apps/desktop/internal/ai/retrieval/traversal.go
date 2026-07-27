package retrieval

import (
	"context"
	"errors"
	"io"
	"os"
	"sort"
	"strings"
	"unicode/utf8"
)

type corpusState struct {
	snapshot       Snapshot
	files, entries int
	bytes          int64
	readBytes      int64
	changed        bool
	err            error
}

func (corpus *Corpus) walk(ctx context.Context, root *os.Root, dir string, depth, attempt int, state *corpusState) {
	if state.err != nil || state.snapshot.Truncated {
		return
	}
	if err := ctx.Err(); err != nil {
		state.err = err
		return
	}
	if depth > MaxTraversalDepth {
		state.limit(dir)
		return
	}
	file, before, class := corpus.openStable(root, dir, true)
	if class != entryOK {
		if class == entryUnreadable {
			state.warn(dir, WarningDirectoryUnreadable)
		} else {
			state.change(dir, WarningDirectoryChanged, attempt)
		}
		return
	}
	entries, readErr := corpus.readDir(file, dir, MaxDirectoryEntries+1)
	after, statErr := file.Stat()
	_ = file.Close()
	current, currentClass := inspectReal(root, dir)
	if contextErr := ctx.Err(); contextErr != nil {
		state.err = contextErr
		return
	}
	if errors.Is(readErr, context.Canceled) || errors.Is(readErr, context.DeadlineExceeded) {
		state.err = readErr
		return
	}
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		if currentClass == entryChanged || currentClass == entryUnsafe || statErr != nil || (current != nil && !os.SameFile(before, current)) {
			state.change(dir, WarningDirectoryChanged, attempt)
		} else {
			state.warn(dir, WarningDirectoryUnreadable)
		}
		return
	}
	if statErr != nil || currentClass != entryOK || !os.SameFile(before, after) || !os.SameFile(before, current) || before.ModTime() != current.ModTime() {
		state.change(dir, WarningDirectoryChanged, attempt)
		return
	}
	if len(entries) > MaxDirectoryEntries {
		state.limit(dir)
		return
	}
	state.entries += len(entries)
	if state.entries > MaxTraversalEntries {
		state.limit(dir)
		return
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			state.err = err
			return
		}
		name := entry.Name()
		if !utf8.ValidString(name) {
			state.warn(dir, WarningInvalidPathEncoding)
			continue
		}
		if strings.HasPrefix(name, ".") || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		path := dir + "/" + name
		if len(path) > MaxRelativePathBytes {
			state.warn(dir, WarningLimit)
			continue
		}
		info, class := inspectReal(root, path)
		if class != entryOK {
			if class == entryUnsafe {
				continue
			}
			if class == entryUnreadable {
				state.warn(path, WarningUnreadable)
			} else if entry.IsDir() {
				state.change(path, WarningDirectoryChanged, attempt)
			} else {
				state.change(path, WarningChanged, attempt)
			}
			continue
		}
		if info.IsDir() {
			if path != "wiki/graph" {
				corpus.walk(ctx, root, path, depth+1, attempt, state)
			}
			continue
		}
		if !info.Mode().IsRegular() || path == "wiki/index.md" || path == "wiki/log.md" || !strings.HasSuffix(name, ".md") {
			continue
		}
		corpus.addFile(ctx, root, path, attempt, state)
	}
}

func (state *corpusState) change(path, code string, attempt int) {
	state.changed = true
	if attempt == 1 {
		state.warn(path, code)
	}
}
func (state *corpusState) warn(path, code string) {
	for _, warning := range state.snapshot.Warnings {
		if warning.Path == path && warning.Code == code {
			return
		}
	}
	if len(state.snapshot.Warnings) < MaxWarnings {
		state.snapshot.Warnings = append(state.snapshot.Warnings, Warning{Path: path, Code: code})
	}
}
func (state *corpusState) limit(path string) {
	state.snapshot.Truncated = true
	state.warn(path, WarningLimit)
}
