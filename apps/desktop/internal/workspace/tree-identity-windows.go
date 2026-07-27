//go:build windows

package workspace

import (
	"os"
	"syscall"
)

func sameTreeRoot(left, right os.FileInfo) bool {
	if !os.SameFile(left, right) {
		return false
	}
	leftData, leftOK := left.Sys().(*syscall.Win32FileAttributeData)
	rightData, rightOK := right.Sys().(*syscall.Win32FileAttributeData)
	return leftOK && rightOK && leftData.CreationTime == rightData.CreationTime
}
