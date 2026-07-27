//go:build windows

package appprivate

import "io/fs"

func privateDirectoryMode(fs.FileInfo) bool { return true }
func privateFileMode(fs.FileInfo) bool      { return true }
