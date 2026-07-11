//go:build !windows

package workspaceid

import "os"

func privateDirectoryMode(info os.FileInfo) bool { return info.Mode().Perm() == 0o700 }
func privateFileMode(info os.FileInfo) bool      { return info.Mode().Perm() == 0o600 }
