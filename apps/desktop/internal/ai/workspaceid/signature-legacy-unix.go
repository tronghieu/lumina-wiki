//go:build !windows

package workspaceid

func platformLegacyHandleSignature(DirectoryHandle) (Signature, bool, error) {
	return "", false, nil
}
