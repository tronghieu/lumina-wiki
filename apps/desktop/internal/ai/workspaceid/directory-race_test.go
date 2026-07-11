package workspaceid

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestIndependentManagersRaceFirstConfirmWithoutGenericDirectoryError(t *testing.T) {
	for iteration := 0; iteration < 20; iteration++ {
		base := t.TempDir()
		now := time.Now().UTC()
		signatures := map[string]Signature{}
		one := testManagerWithSeed(t, base, &now, signatures, 1)
		two := testManagerWithSeed(t, base, &now, signatures, 90)
		rootOne, rootTwo := makeWorkspace(t), makeWorkspace(t)
		signatures[rootOne], signatures[rootTwo] = "one", "two"
		decisionOne, err := one.BeginAttach(rootOne)
		if err != nil {
			t.Fatal(err)
		}
		decisionTwo, err := two.BeginAttach(rootTwo)
		if err != nil {
			t.Fatal(err)
		}

		arrived := make(chan struct{}, 2)
		release := make(chan struct{})
		wrapMkdir := func(path string, mode fs.FileMode) error {
			arrived <- struct{}{}
			<-release
			return os.Mkdir(path, mode)
		}
		one.store.mkdir, two.store.mkdir = wrapMkdir, wrapMkdir
		results := make(chan error, 2)
		var group sync.WaitGroup
		group.Add(2)
		go func() { defer group.Done(); _, err := one.ConfirmAttach(decisionOne.Token); results <- err }()
		go func() { defer group.Done(); _, err := two.ConfirmAttach(decisionTwo.Token); results <- err }()
		<-arrived
		<-arrived
		close(release)
		group.Wait()
		close(results)
		successes := 0
		for err := range results {
			if err == nil {
				successes++
				continue
			}
			if !errors.Is(err, ErrRegistryBusy) && !errors.Is(err, ErrRegistryConflict) {
				t.Fatalf("iteration %d returned generic race error: %v", iteration, err)
			}
		}
		if successes != 1 {
			t.Fatalf("iteration %d successes = %d, want 1", iteration, successes)
		}
		registry, err := one.store.Load()
		if err != nil {
			t.Fatalf("iteration %d invalid registry: %v", iteration, err)
		}
		if err := registry.validate(); err != nil {
			t.Fatalf("iteration %d invalid records: %v", iteration, err)
		}
	}
}

func TestEnsureDirRevalidatesMaliciousEEXISTReplacement(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation has platform privileges")
	}
	base := t.TempDir()
	store, err := newRegistryStore(base)
	if err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	store.mkdir = func(path string, _ fs.FileMode) error {
		if err := os.Symlink(outside, path); err != nil {
			t.Fatal(err)
		}
		return fs.ErrExist
	}
	if _, err := store.ensureDir(true); err == nil {
		t.Fatal("EEXIST symlink replacement accepted")
	}
	if info, err := os.Lstat(store.dir); err != nil || info.Mode()&fs.ModeSymlink == 0 {
		t.Fatalf("test replacement missing: %v, %#v", err, info)
	}
	if _, err := os.Stat(filepath.Join(outside, registryFileName)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("malicious target was followed")
	}
}
