package appprivate

import (
	"os"
)

// ProtectPrivateHandle applies the platform's exact app-private protection
// policy to an already-open file or directory handle.
func ProtectPrivateHandle(file *os.File, mode os.FileMode) error {
	if file == nil {
		return ErrInvalidConfiguration
	}
	if err := platformProtectHandle(file, mode); err != nil {
		return err
	}
	return platformValidateProtectedHandle(file)
}

// ValidatePrivateHandle verifies the platform's exact app-private protection
// policy through an already-open file or directory handle.
func ValidatePrivateHandle(file *os.File) error {
	if file == nil {
		return ErrInvalidConfiguration
	}
	return platformValidateProtectedHandle(file)
}
