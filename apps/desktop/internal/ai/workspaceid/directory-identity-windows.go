//go:build windows

package workspaceid

import "os"

func sameDirectoryHandles(left, right DirectoryHandle) bool {
	leftSignature, leftOK, leftErr := platformHandleSignature(left)
	rightSignature, rightOK, rightErr := platformHandleSignature(right)
	if leftErr == nil && rightErr == nil && leftOK && rightOK {
		return leftSignature == rightSignature
	}
	_, leftIsFile := left.(*os.File)
	_, rightIsFile := right.(*os.File)
	if leftIsFile || rightIsFile {
		return false
	}
	leftInfo, leftErr := left.Stat()
	rightInfo, rightErr := right.Stat()
	return leftErr == nil && rightErr == nil &&
		leftInfo.IsDir() && rightInfo.IsDir() &&
		os.SameFile(leftInfo, rightInfo)
}
