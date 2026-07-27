//go:build windows

package appprivate

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

func syncRootDirectory(root *os.Root) error {
	directory, err := root.Open(".")
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
