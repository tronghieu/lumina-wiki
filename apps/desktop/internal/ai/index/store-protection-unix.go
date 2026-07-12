//go:build !windows

package index

import "os"

func platformProtectIndexHandle(file *os.File, mode os.FileMode) error { return file.Chmod(mode) }
func platformEnsureIndexProtectedHandle(*os.File) error                { return nil }
func privateIndexFile(info os.FileInfo) bool                           { return info.Mode().Perm() == 0o600 }
func privateIndexDirectory(info os.FileInfo) bool                      { return info.Mode().Perm() == 0o700 }
