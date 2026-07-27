//go:build windows

package workspaceid

import (
	"errors"
	"os"
	"testing"

	"golang.org/x/sys/windows"
)

func renameTrustedRootForTest(t *testing.T, oldPath, newPath string) bool {
	t.Helper()
	err := os.Rename(oldPath, newPath)
	if err == nil {
		return true
	}
	if errors.Is(err, windows.ERROR_SHARING_VIOLATION) ||
		errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return false
	}
	t.Fatal(err)
	return false
}
