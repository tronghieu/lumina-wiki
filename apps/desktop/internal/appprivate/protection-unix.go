//go:build !windows

package appprivate

import (
	"errors"
	"os"
)

func platformProtectHandle(file *os.File, mode os.FileMode) error {
	return file.Chmod(mode)
}

func platformValidateProtectedHandle(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	want := os.FileMode(0o600)
	if info.IsDir() {
		want = 0o700
	}
	if info.Mode().Perm() != want {
		return errors.New("private mode is unsafe")
	}
	return nil
}
