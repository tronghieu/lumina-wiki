//go:build !linux && !darwin && !freebsd && !openbsd && !netbsd && !dragonfly && !windows

package workspaceid

// Unsupported platforms use path plus open-handle ownership without a reusable signature.
func platformHandleSignature(DirectoryHandle) (Signature, bool, error) { return "", false, nil }
