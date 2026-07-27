//go:build !windows

package workspaceid

import "os"

func sameDirectoryHandles(left, right DirectoryHandle) bool {
	leftInfo, leftErr := left.Stat()
	rightInfo, rightErr := right.Stat()
	return leftErr == nil && rightErr == nil &&
		leftInfo.IsDir() && rightInfo.IsDir() &&
		os.SameFile(leftInfo, rightInfo)
}
