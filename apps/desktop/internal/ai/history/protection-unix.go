//go:build !windows

package history

import "os"

func platformProtectHandle(file *os.File, mode os.FileMode) error { return file.Chmod(mode) }
func platformEnsureProtectedHandle(*os.File) error                { return nil }
