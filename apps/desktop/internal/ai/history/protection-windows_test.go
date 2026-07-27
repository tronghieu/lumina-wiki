//go:build windows

package history

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appprivate"
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

func TestWindowsHistoryPreservesSharedAppPrivateProtection(t *testing.T) {
	base := t.TempDir()
	store, err := NewHistoryStore(base, workspaceid.WorkspaceID("ws_11111111111111111111111111111111"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetEnabled(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	directory, err := os.Open(filepath.Join(base, ownedLeaf))
	if err != nil {
		t.Fatal(err)
	}
	defer directory.Close()
	if err := appprivate.ValidatePrivateHandle(directory); err != nil {
		t.Fatalf("history changed shared app protection: %v", err)
	}
}
