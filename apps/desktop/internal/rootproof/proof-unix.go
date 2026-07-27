//go:build !windows

package rootproof

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"syscall"
)

type platformProof struct {
	device uint64
	inode  uint64
}

func openPlatformRoot(path string) (*os.Root, os.FileInfo, platformProof, error) {
	before, err := os.Lstat(path)
	if err != nil || !before.IsDir() || before.Mode()&fs.ModeSymlink != 0 {
		return nil, nil, platformProof{}, errors.New("root is not a physical directory")
	}
	identity, ok := before.Sys().(*syscall.Stat_t)
	if !ok {
		return nil, nil, platformProof{}, errors.New("root identity is unavailable")
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, nil, platformProof{}, errors.New("root cannot be held")
	}
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) {
		_ = root.Close()
		return nil, nil, platformProof{}, errors.New("root changed while opening")
	}
	return root, before, platformProof{
		device: uint64(identity.Dev),
		inode:  uint64(identity.Ino),
	}, nil
}

func (p platformProof) signature() (string, bool) {
	return fmt.Sprintf("unix-v1:%x:%x", p.device, p.inode), true
}

func (p platformProof) validate(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return errors.New("root platform identity changed")
	}
	identity, ok := info.Sys().(*syscall.Stat_t)
	if !ok || uint64(identity.Dev) != p.device || uint64(identity.Ino) != p.inode {
		return errors.New("root platform identity changed")
	}
	return nil
}

func (p platformProof) close() error {
	return nil
}
