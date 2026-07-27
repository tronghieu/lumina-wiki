//go:build !linux && !darwin && !windows

package workspace

import (
	"errors"
	"os"
)

func platformPublishNoReplace(*os.Root, string, string) error {
	return errors.New("atomic no-replace publication is unsupported")
}
