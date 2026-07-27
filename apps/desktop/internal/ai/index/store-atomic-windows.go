//go:build windows

package index

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func stableIndexRoot(root *os.Root) (os.FileInfo, error) {
	opened, err := root.Stat(".")
	if err != nil {
		return nil, errors.New("stat semantic index root failed")
	}
	current, err := os.Lstat(root.Name())
	if err != nil || !current.IsDir() || !os.SameFile(opened, current) {
		return nil, errors.New("semantic index root changed")
	}
	return opened, nil
}

func platformReplaceIndexFile(root *os.Root, oldName, newName string) error {
	before, err := stableIndexRoot(root)
	if err != nil {
		return err
	}
	from, err := windows.UTF16PtrFromString(filepath.Join(root.Name(), oldName))
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(filepath.Join(root.Name(), newName))
	if err != nil {
		return err
	}
	if err := windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH); err != nil {
		return err
	}
	after, err := stableIndexRoot(root)
	if err != nil || !os.SameFile(before, after) {
		return errors.New("semantic index root changed")
	}
	return nil
}

// Windows does not provide portable directory File.Sync semantics. Each file
// replacement is write-through; this stage revalidates the pinned parent.
func platformSyncIndexRoot(root *os.Root) error { _, err := stableIndexRoot(root); return err }
