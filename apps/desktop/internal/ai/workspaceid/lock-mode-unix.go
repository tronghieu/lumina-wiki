//go:build !windows

package workspaceid

import "os"

func platformSecureLockMode(file *os.File) error { return file.Chmod(0o600) }
