//go:build !windows

package workspace

import (
	"os"
	"testing"
)

func renameHeldWorkspaceRootForTest(t *testing.T, oldPath, newPath string) bool {
	t.Helper()
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatal(err)
	}
	return true
}
