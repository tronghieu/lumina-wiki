//go:build windows

package rootproof

import (
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

type fileIDInfo struct {
	VolumeSerialNumber uint64
	FileID             [16]byte
}

type platformProof struct {
	handle *os.File
	volume uint64
	fileID [16]byte
}

func openPlatformRoot(path string) (*os.Root, platformProof, error) {
	before, err := os.Lstat(path)
	if err != nil || !before.IsDir() || before.Mode()&fs.ModeSymlink != 0 {
		return nil, platformProof{}, errors.New("root is not a physical directory")
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, platformProof{}, errors.New("root cannot be held")
	}
	rootHandle, err := root.Open(".")
	if err != nil {
		_ = root.Close()
		return nil, platformProof{}, errors.New("root identity handle cannot be held")
	}
	rootIdentity, err := queryFileID(rootHandle)
	_ = rootHandle.Close()
	if err != nil {
		_ = root.Close()
		return nil, platformProof{}, errors.New("root platform identity is unavailable")
	}
	handle, err := os.Open(path)
	if err != nil {
		_ = root.Close()
		return nil, platformProof{}, errors.New("root identity handle cannot be held")
	}
	identity, err := queryFileID(handle)
	if err != nil || identity != rootIdentity {
		_ = handle.Close()
		_ = root.Close()
		return nil, platformProof{}, errors.New("root changed while opening")
	}
	current, err := os.Lstat(path)
	if err != nil || !current.IsDir() || current.Mode()&fs.ModeSymlink != 0 {
		_ = handle.Close()
		_ = root.Close()
		return nil, platformProof{}, errors.New("root changed while opening")
	}
	return root, platformProof{
		handle: handle,
		volume: identity.VolumeSerialNumber,
		fileID: identity.FileID,
	}, nil
}

func queryFileID(file *os.File) (fileIDInfo, error) {
	var identity fileIDInfo
	err := windows.GetFileInformationByHandleEx(
		windows.Handle(file.Fd()),
		windows.FileIdInfo,
		(*byte)(unsafe.Pointer(&identity)),
		uint32(unsafe.Sizeof(identity)),
	)
	return identity, err
}

func (p platformProof) signature() (string, bool) {
	if p.handle == nil {
		return "", false
	}
	return fmt.Sprintf("windows-v1:%x:%s", p.volume, hex.EncodeToString(p.fileID[:])), true
}

func (p platformProof) validate(path string) error {
	if p.handle == nil {
		return errors.New("root platform identity is unavailable")
	}
	held, err := queryFileID(p.handle)
	if err != nil || held.VolumeSerialNumber != p.volume || held.FileID != p.fileID {
		return errors.New("held root platform identity changed")
	}
	current, err := os.Open(path)
	if err != nil {
		return errors.New("root platform identity changed")
	}
	defer current.Close()
	identity, err := queryFileID(current)
	if err != nil || identity.VolumeSerialNumber != p.volume || identity.FileID != p.fileID {
		return errors.New("root platform identity changed")
	}
	return nil
}

func (p platformProof) validateRoot(root *os.Root) error {
	current, err := root.Open(".")
	if err != nil {
		return errors.New("root platform identity changed")
	}
	defer current.Close()
	identity, err := queryFileID(current)
	if err != nil || identity.VolumeSerialNumber != p.volume || identity.FileID != p.fileID {
		return errors.New("root platform identity changed")
	}
	return nil
}

func (p platformProof) close() error {
	if p.handle == nil {
		return nil
	}
	return p.handle.Close()
}
