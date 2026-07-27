//go:build !windows

package appprivate

import "io/fs"

func privateDirectoryMode(info fs.FileInfo) bool { return info.Mode().Perm() == 0o700 }
func privateFileMode(info fs.FileInfo) bool      { return info.Mode().Perm() == 0o600 }
