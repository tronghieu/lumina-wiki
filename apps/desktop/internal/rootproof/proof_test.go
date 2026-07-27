package rootproof

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenHoldsCanonicalDirectory(t *testing.T) {
	rootPath := t.TempDir()
	proof, err := Open(rootPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = proof.Close() })

	if got := proof.Path(); got != rootPath {
		t.Fatalf("Path() = %q, want %q", got, rootPath)
	}
	if proof.Version() != CurrentVersion {
		t.Fatalf("Version() = %d, want %d", proof.Version(), CurrentVersion)
	}
	if signature, ok := proof.Signature(); !ok || signature == "" {
		t.Fatal("platform signature is unavailable")
	}
	if err := proof.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	lease, err := proof.OpenRoot()
	if err != nil {
		t.Fatalf("OpenRoot: %v", err)
	}
	if opened, err := lease.Stat("."); err != nil || !opened.IsDir() {
		t.Fatalf("leased root: %+v %v", opened, err)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestOpenRejectsRelativeAndSymlinkRoots(t *testing.T) {
	if _, err := Open("relative"); err == nil {
		t.Fatal("Open accepted a relative path")
	}

	parent := t.TempDir()
	target := filepath.Join(parent, "target")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(parent, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := Open(link); err == nil {
		t.Fatal("Open accepted a symlink root")
	}
}

func TestZeroAndClosedProofsAreInvalid(t *testing.T) {
	var zero RootProof
	if err := zero.Validate(); err == nil {
		t.Fatal("zero proof is valid")
	}
	if _, err := zero.OpenRoot(); err == nil {
		t.Fatal("zero proof opened a root")
	}

	proof, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := proof.Close(); err != nil {
		t.Fatal(err)
	}
	if err := proof.Validate(); err == nil {
		t.Fatal("closed proof is valid")
	}
	if _, err := proof.OpenRoot(); err == nil {
		t.Fatal("closed proof opened a root")
	}
}

func TestValidateRejectsPathReplacement(t *testing.T) {
	parent := t.TempDir()
	rootPath := filepath.Join(parent, "root")
	if err := os.Mkdir(rootPath, 0o700); err != nil {
		t.Fatal(err)
	}
	proof, err := Open(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = proof.Close() })
	if err := os.Rename(rootPath, filepath.Join(parent, "moved")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(rootPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := proof.Validate(); err == nil {
		t.Fatal("proof accepted a replacement at the original path")
	}
	if _, err := proof.OpenRoot(); err == nil {
		t.Fatal("proof opened a replacement at the original path")
	}
}
