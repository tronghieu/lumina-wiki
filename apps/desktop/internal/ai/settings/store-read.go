package settings

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
)

func (s *ConfigStore) readBounded() ([]byte, bool, bool, error) {
	before, err := os.Lstat(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, true, false, nil
	}
	if err != nil {
		return nil, false, false, fmt.Errorf("stat config: %w", err)
	}
	if before.Mode()&fs.ModeSymlink != 0 || !before.Mode().IsRegular() {
		return nil, false, false, errors.New("config path must be a regular file")
	}
	if before.Size() > MaxConfigBytes {
		return nil, false, false, errors.New("config exceeds size limit")
	}
	file, err := s.openFile(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, true, nil
	}
	if err != nil {
		return nil, false, false, fmt.Errorf("open config: %w", err)
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, false, false, fmt.Errorf("stat opened config: %w", err)
	}
	if !os.SameFile(before, opened) {
		return nil, false, true, nil
	}
	limited := &io.LimitedReader{R: file, N: MaxConfigBytes + 1}
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, false, false, fmt.Errorf("read config: %w", err)
	}
	if len(raw) > MaxConfigBytes {
		return nil, false, false, errors.New("config exceeds size limit")
	}
	return raw, false, false, nil
}
