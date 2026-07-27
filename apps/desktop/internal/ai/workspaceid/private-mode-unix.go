//go:build !windows

package workspaceid

import (
	"errors"
	"os"
)

func privateDirectoryMode(info os.FileInfo) bool { return info.Mode().Perm() == 0o700 }
func privateFileMode(info os.FileInfo) bool      { return info.Mode().Perm() == 0o600 }

func platformSecurePrivateDirectory(path string, _ os.FileInfo) error { return os.Chmod(path, 0o700) }
func platformValidatePrivateDirectory(_ string, info os.FileInfo) bool {
	return platformPrivateDirectoryValidationError("", info) == nil
}
func platformPrivateDirectoryValidationError(_ string, info os.FileInfo) error {
	if !privateDirectoryMode(info) {
		return errors.New("registry directory mode is unsafe")
	}
	return nil
}
func platformSecurePrivateFile(file *os.File) error { return file.Chmod(0o600) }
func platformValidatePrivateFile(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && privateFileMode(info)
}
