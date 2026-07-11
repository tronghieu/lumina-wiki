package retrieval

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"unicode/utf8"
)

func (corpus *Corpus) verifyFile(ctx context.Context, root *os.Root, path string, expected os.FileInfo,
	readLimit int64, expectedHash [sha256.Size]byte) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	file, before, class := corpus.openStable(root, path, false)
	if class != entryOK {
		if class == entryUnreadable {
			return WarningUnreadable, nil
		}
		return WarningChanged, nil
	}
	if !sameSnapshotFile(expected, before) {
		_ = file.Close()
		return WarningChanged, nil
	}
	raw, readErr := readContext(ctx, file, readLimit)
	if err := ctx.Err(); err != nil {
		_ = file.Close()
		return "", err
	}
	after, statErr := file.Stat()
	_ = file.Close()
	current, currentClass := inspectReal(root, path)
	if currentClass == entryChanged || currentClass == entryUnsafe {
		return WarningChanged, nil
	}
	if currentClass == entryUnreadable || statErr != nil {
		return WarningUnreadable, nil
	}
	if !sameSnapshotFile(expected, after) || !sameSnapshotFile(expected, current) {
		return WarningChanged, nil
	}
	if readErr != nil {
		if errors.Is(readErr, context.Canceled) || errors.Is(readErr, context.DeadlineExceeded) {
			return "", readErr
		}
		return WarningUnreadable, nil
	}
	if int64(len(raw)) > readLimit || !utf8.Valid(raw) || sha256.Sum256(raw) != expectedHash {
		return WarningChanged, nil
	}
	return "", nil
}

func sameSnapshotFile(expected, current os.FileInfo) bool {
	return expected != nil && current != nil && os.SameFile(expected, current) && expected.Mode().IsRegular() &&
		current.Mode().IsRegular() && expected.Size() == current.Size() && expected.ModTime() == current.ModTime()
}
