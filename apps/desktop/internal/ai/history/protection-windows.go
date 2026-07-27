//go:build windows

package history

import (
	"os"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appprivate"
)

func platformProtectHandle(file *os.File, mode os.FileMode) error {
	return appprivate.ProtectPrivateHandle(file, mode)
}

func platformEnsureProtectedHandle(file *os.File) error {
	return appprivate.ProtectPrivateHandle(file, 0o600)
}
