package secrets

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"syscall"
)

func classifyPlatformKeyringError(err error, goos string) CredentialStatus {
	switch goos {
	case "darwin":
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			// Upstream invokes fixed /usr/bin/security with our fixed service and
			// validated ref, then discards diagnostics. The remaining exit shape
			// cannot distinguish lock, denial, or availability; all are keychain
			// operational failures requiring explicit session confirmation.
			return StatusUnavailable
		}
	case "windows":
		var errno syscall.Errno
		if errors.As(err, &errno) {
			switch uintptr(errno) {
			case 5, 1223: // access denied; operation cancelled
				return StatusDenied
			case 1312, 1058, 1062: // no logon session; service disabled/stopped
				return StatusUnavailable
			case 50: // operation not supported
				return StatusUnsupported
			}
		}
	case "linux", "freebsd", "netbsd", "openbsd", "dragonfly":
		var pathErr *os.PathError
		if errors.As(err, &pathErr) {
			if errors.Is(pathErr, syscall.EACCES) || errors.Is(pathErr, syscall.EPERM) {
				return StatusDenied
			}
			if errors.Is(pathErr, syscall.ENOENT) || errors.Is(pathErr, syscall.ECONNREFUSED) ||
				errors.Is(pathErr, syscall.ENOTCONN) || errors.Is(pathErr, syscall.ECONNRESET) {
				return StatusUnavailable
			}
			return StatusFailure
		}
	}

	// D-Bus may expose only a stable error name or description through the
	// upstream API. Use narrow names after typed shapes, never in output.
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "org.freedesktop.dbus.error.accessdenied") {
		return StatusDenied
	}
	if strings.Contains(message, "org.freedesktop.dbus.error.serviceunknown") ||
		strings.Contains(message, "org.freedesktop.dbus.error.noserver") {
		return StatusUnavailable
	}
	return StatusFailure
}
