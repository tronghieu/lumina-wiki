//go:build !windows

package workspaceid

import (
	"os"
	"testing"
)

func renameTrustedRootForTest(t *testing.T, oldPath, newPath string) bool {
	t.Helper()
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatal(err)
	}
	return true
}
