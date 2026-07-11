package retrieval

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"unicode/utf8"
)

func (corpus *Corpus) addFile(ctx context.Context, root *os.Root, path string, attempt int, state *corpusState) {
	if state.files >= MaxCorpusFiles {
		state.limit(path)
		return
	}
	remaining := MaxCorpusBytes - state.bytes
	raw, size, code, err := corpus.readFile(ctx, root, path, attempt, remaining, state)
	if err != nil {
		state.err = err
		return
	}
	if code != "" {
		if code == WarningLimit {
			state.limit(path)
			return
		}
		if code == WarningChanged {
			state.changed = true
			if attempt == 0 {
				return
			}
		}
		state.warn(path, code)
		return
	}
	if state.bytes+size > MaxCorpusBytes {
		state.limit(path)
		return
	}
	sum := sha256.Sum256(raw)
	state.snapshot.Documents = append(state.snapshot.Documents, Document{Path: path, Content: string(raw), ContentHash: hex.EncodeToString(sum[:]), Size: size})
	state.files++
	state.bytes += size
}

func (corpus *Corpus) readFile(ctx context.Context, root *os.Root, path string, attempt int, remaining int64, state *corpusState) ([]byte, int64, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, 0, "", err
	}
	file, before, class := corpus.openStable(root, path, false)
	if class != entryOK {
		if class == entryUnreadable {
			return nil, 0, WarningUnreadable, nil
		}
		return nil, 0, WarningChanged, nil
	}
	if !before.Mode().IsRegular() {
		_ = file.Close()
		return nil, 0, WarningUnreadable, nil
	}
	if before.Size() > MaxFileBytes {
		_ = file.Close()
		return nil, 0, WarningOversize, nil
	}
	if before.Size() > remaining {
		_ = file.Close()
		return nil, 0, WarningLimit, nil
	}
	plannedReads := (before.Size() + 1) * FileVerificationReads
	if state.readBytes+plannedReads > MaxCorpusSnapshotReadBytes {
		_ = file.Close()
		return nil, 0, WarningLimit, nil
	}
	state.readBytes += plannedReads
	readLimit := before.Size()
	raw, readErr := readContext(ctx, file, readLimit)
	if corpus.afterRead != nil {
		corpus.afterRead(path, attempt)
	}
	if err := ctx.Err(); err != nil {
		_ = file.Close()
		return nil, 0, "", err
	}
	after, statErr := file.Stat()
	_ = file.Close()
	current, currentClass := inspectReal(root, path)
	changed := currentClass == entryChanged || currentClass == entryUnsafe
	if current != nil && (!os.SameFile(before, current) || before.Size() != current.Size() || before.ModTime() != current.ModTime()) {
		changed = true
	}
	if changed {
		return nil, 0, WarningChanged, nil
	}
	if currentClass == entryUnreadable || statErr != nil {
		return nil, 0, WarningUnreadable, nil
	}
	if !os.SameFile(before, after) || before.Size() != after.Size() {
		return nil, 0, WarningChanged, nil
	}
	if readErr != nil {
		if errors.Is(readErr, context.Canceled) {
			return nil, 0, "", readErr
		}
		return nil, 0, WarningUnreadable, nil
	}
	if int64(len(raw)) > readLimit {
		return nil, 0, WarningChanged, nil
	}
	if !utf8.Valid(raw) {
		return nil, 0, WarningInvalidUTF8, nil
	}
	sum := sha256.Sum256(raw)
	code, err := corpus.verifyFile(ctx, root, path, before, readLimit, sum)
	if err != nil || code != "" {
		return nil, 0, code, err
	}
	return raw, int64(len(raw)), "", nil
}
