//go:build windows

package workspaceid

import "os"

func platformSecureLockMode(*os.File) error { return nil }
