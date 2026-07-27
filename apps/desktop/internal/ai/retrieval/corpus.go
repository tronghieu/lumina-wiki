package retrieval

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"sort"
)

type Corpus struct {
	afterRead func(string, int)
	openFile  func(*os.Root, string) (*os.File, error)
	readDir   func(*os.File, string, int) ([]os.DirEntry, error)
}

func rootCurrent(root *os.Root) bool {
	opened, err := root.Stat(".")
	if err != nil {
		return false
	}
	current, err := os.Stat(root.Name())
	return err == nil && current.IsDir() && os.SameFile(opened, current)
}

func readContext(ctx context.Context, file io.ReadCloser, limit int64) ([]byte, error) {
	type result struct {
		raw []byte
		err error
	}
	done := make(chan result, 1)
	go func() {
		raw, err := io.ReadAll(&io.LimitedReader{R: file, N: limit + 1})
		done <- result{raw, err}
	}()
	select {
	case <-ctx.Done():
		_ = file.Close()
		return nil, ctx.Err()
	case result := <-done:
		return result.raw, result.err
	}
}

func NewCorpus() *Corpus {
	return &Corpus{
		openFile: func(root *os.Root, name string) (*os.File, error) { return root.Open(name) },
		readDir:  func(file *os.File, _ string, count int) ([]os.DirEntry, error) { return file.ReadDir(count) },
	}
}

// Snapshot accepts a canonical root previously authorized by the backend. It
// revalidates safety, but is not an authorization boundary.
func (corpus *Corpus) Snapshot(ctx context.Context, rootPath string) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	for attempt := 0; attempt < MaxSnapshotAttempts; attempt++ {
		root, err := openWorkspace(rootPath)
		if err != nil {
			return Snapshot{}, err
		}
		openedRoot, err := root.Stat(".")
		if err != nil {
			_ = root.Close()
			return Snapshot{}, errChanged
		}
		snapshot, changed, err := corpus.scan(ctx, root, attempt)
		rootChanged := !rootCurrent(root)
		if rootChanged {
			changed = true
		}
		_ = root.Close()
		if err != nil {
			return Snapshot{}, err
		}
		if rootChanged && attempt == 1 {
			snapshot.Documents = []Document{}
			if len(snapshot.Warnings) < MaxWarnings {
				snapshot.Warnings = append(snapshot.Warnings, Warning{Path: "wiki", Code: WarningChanged})
			}
			sort.Slice(snapshot.Warnings, func(i, j int) bool {
				a, b := snapshot.Warnings[i], snapshot.Warnings[j]
				return a.Path+a.Code < b.Path+b.Code
			})
		}
		if !changed || attempt == 1 {
			snapshot.rootIdentity = openedRoot
			snapshot.rootCurrent = !rootChanged
			snapshot.SnapshotHash = hashSnapshot(snapshot.Documents)
			return snapshot, nil
		}
	}
	panic("unreachable")
}

func (corpus *Corpus) scan(ctx context.Context, root *os.Root, attempt int) (Snapshot, bool, error) {
	state := corpusState{snapshot: Snapshot{Documents: []Document{}, Warnings: []Warning{}}}
	corpus.walk(ctx, root, "wiki", 0, attempt, &state)
	if state.err != nil {
		return Snapshot{}, false, state.err
	}
	sort.Slice(state.snapshot.Documents, func(i, j int) bool { return state.snapshot.Documents[i].Path < state.snapshot.Documents[j].Path })
	sort.Slice(state.snapshot.Warnings, func(i, j int) bool {
		a, b := state.snapshot.Warnings[i], state.snapshot.Warnings[j]
		return a.Path+a.Code < b.Path+b.Code
	})
	return state.snapshot, state.changed, nil
}

func hashSnapshot(documents []Document) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte(PolicyVersion + "\n"))
	for _, d := range documents {
		_, _ = hash.Write([]byte(d.Path + "\x00" + d.ContentHash + "\n"))
	}
	return hex.EncodeToString(hash.Sum(nil))
}
