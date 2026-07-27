//go:build !windows

package workspace

import "os"

func sameTreeRoot(left, right os.FileInfo) bool {
	return os.SameFile(left, right)
}
