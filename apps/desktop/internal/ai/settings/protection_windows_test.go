//go:build windows

package settings

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appprivate"
)

func TestWindowsSavePreservesSharedAppPrivateProtection(t *testing.T) {
	base := t.TempDir()
	privateStore, err := appprivate.NewStore(base, "settings-protection-test", 1024)
	if err != nil {
		t.Fatal(err)
	}
	if err := privateStore.Write(context.Background(), []byte("private")); err != nil {
		t.Fatal(err)
	}
	config, err := NewConfigStore(base)
	if err != nil {
		t.Fatal(err)
	}
	if err := config.Save(DefaultConfig()); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{
		filepath.Join(base, ownedConfigDirName),
		filepath.Join(base, ownedConfigDirName, configFileName),
	} {
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		validateErr := appprivate.ValidatePrivateHandle(file)
		file.Close()
		if validateErr != nil {
			t.Fatalf("%s protection changed: %v", filepath.Base(path), validateErr)
		}
	}
}
