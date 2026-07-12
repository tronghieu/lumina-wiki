//go:build !windows

package index

import "os"

func platformProtectIndexHandle(file *os.File, mode os.FileMode) error { return file.Chmod(mode) }
func platformValidateIndexProtectedHandle(file *os.File) error {
	info, err := file.Stat()
	if err != nil || info.Mode().Perm() != 0o600 {
		return os.ErrPermission
	}
	return nil
}
func privateIndexFile(info os.FileInfo) bool      { return info.Mode().Perm() == 0o600 }
func privateIndexDirectory(info os.FileInfo) bool { return info.Mode().Perm() == 0o700 }
