//go:build !windows

package rootproof

import (
	"os"
	"testing"
)

func renameHeldRootForTest(t *testing.T, oldPath, newPath string) bool {
	t.Helper()
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatal(err)
	}
	return true
}
