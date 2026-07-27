//go:build linux

package workspace

import (
	"os"
	"path"

	"golang.org/x/sys/unix"
)

func platformPublishNoReplace(root *os.Root, oldName, newName string) error {
	oldParent, err := root.Open(path.Dir(oldName))
	if err != nil {
		return err
	}
	defer oldParent.Close()
	newParent, err := root.Open(path.Dir(newName))
	if err != nil {
		return err
	}
	defer newParent.Close()
	return unix.Renameat2(
		int(oldParent.Fd()), path.Base(oldName),
		int(newParent.Fd()), path.Base(newName),
		unix.RENAME_NOREPLACE,
	)
}
