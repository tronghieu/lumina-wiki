package workspace

import (
	"errors"
	"io/fs"
	"os"
	"testing"
)

func TestPlatformPublisherNeverReplacesDestination(t *testing.T) {
	rootPath := t.TempDir()
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for name, content := range map[string]string{"source": "source", "destination": "foreign"} {
		file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.WriteString(content); err != nil {
			file.Close()
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	err = platformPublishNoReplace(root, "source", "destination")
	if err == nil || (!errors.Is(err, fs.ErrExist) && !errors.Is(err, os.ErrExist)) {
		t.Fatalf("collision error = %v", err)
	}
	raw, err := os.ReadFile(rootPath + string(os.PathSeparator) + "destination")
	if err != nil || string(raw) != "foreign" {
		t.Fatalf("destination=%q err=%v", raw, err)
	}
}

func TestPlatformPublisherPublishesAbsentDestination(t *testing.T) {
	rootPath := t.TempDir()
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	source, err := root.OpenFile("source", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.WriteString("source"); err != nil {
		source.Close()
		t.Fatal(err)
	}
	if err := source.Close(); err != nil {
		t.Fatal(err)
	}
	if err := platformPublishNoReplace(root, "source", "destination"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(rootPath + string(os.PathSeparator) + "destination")
	if err != nil || string(raw) != "source" {
		t.Fatalf("destination=%q err=%v", raw, err)
	}
	if _, err := root.Lstat("source"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("source survived rename: %v", err)
	}
}
