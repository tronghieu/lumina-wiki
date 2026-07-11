//go:build linux || darwin || freebsd || openbsd || netbsd || dragonfly

package workspaceid

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

func platformSignatureFromInfo(info os.FileInfo) (Signature, bool, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", false, nil
	}
	return Signature(fmt.Sprintf("unix:%x:%x", uint64(stat.Dev), uint64(stat.Ino))), true, nil
}

func platformHandleSignature(handle DirectoryHandle) (Signature, bool, error) {
	info, err := handle.Stat()
	if err != nil {
		return "", false, errors.New("workspace identity probe failed")
	}
	return platformSignatureFromInfo(info)
}
