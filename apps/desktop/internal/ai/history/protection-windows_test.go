//go:build windows

package history

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsProtectionReopensWithWriteDAC(t *testing.T) {
	path := filepath.Join(t.TempDir(), "protected")
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open ordinary handle: %v", err)
	}
	defer file.Close()
	if err := platformProtectHandle(file, 0o600); err != nil {
		t.Fatalf("apply protected DACL: %v", err)
	}
}
