//go:build !windows

package index

import "os"

func platformReplaceIndexFile(root *os.Root, oldName, newName string) error {
	return root.Rename(oldName, newName)
}

func platformSyncIndexRoot(root *os.Root) error {
	directory, err := root.Open(".")
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
