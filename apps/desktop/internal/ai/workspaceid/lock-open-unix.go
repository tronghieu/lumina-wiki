//go:build !windows

package workspaceid

import "os"

func openRegistryLock(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
}
