//go:build !windows

package workspaceid

import "os"

func platformSecureLockMode(file *os.File) error { return platformSecurePrivateFile(file) }
