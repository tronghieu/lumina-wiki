//go:build !windows

package workspaceid

import "os"

func privateDirectoryMode(info os.FileInfo) bool { return info.Mode().Perm() == 0o700 }
func privateFileMode(info os.FileInfo) bool      { return info.Mode().Perm() == 0o600 }

func platformSecurePrivateDirectory(path string, _ os.FileInfo) error { return os.Chmod(path, 0o700) }
func platformValidatePrivateDirectory(_ string, info os.FileInfo) bool {
	return privateDirectoryMode(info)
}
func platformSecurePrivateFile(file *os.File) error { return file.Chmod(0o600) }
func platformValidatePrivateFile(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && privateFileMode(info)
}
