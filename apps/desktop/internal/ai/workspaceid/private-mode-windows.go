//go:build windows

package workspaceid

import "os"

func privateDirectoryMode(os.FileInfo) bool { return true }
func privateFileMode(os.FileInfo) bool      { return true }
