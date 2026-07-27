//go:build windows

package workspace

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

func syncDirectory(root *os.Root, name string) error {
	directory, err := root.Open(name)
	if err != nil {
		return err
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil &&
		!errors.Is(err, windows.ERROR_INVALID_HANDLE) &&
		!errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return err
	}
	return nil
}
