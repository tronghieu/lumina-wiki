package settings

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

const (
	ownedConfigDirName = "lumina-wiki-desktop"
	configFileName     = "ai-settings.json"
)

type ConfigStore struct {
	dir      string
	path     string
	openFile func(string) (*os.File, error)
}

// NewConfigStore accepts an absolute trusted platform config base. The store
// creates and chmods only its fixed owned child; it never mutates the base.
func NewConfigStore(base string) (*ConfigStore, error) {
	if base == "" || !filepath.IsAbs(base) {
		return nil, errors.New("absolute config base directory is required")
	}
	dir := filepath.Join(filepath.Clean(base), ownedConfigDirName)
	return &ConfigStore{dir: dir, path: filepath.Join(dir, configFileName), openFile: os.Open}, nil
}

func (s *ConfigStore) Load() (Config, error) {
	if err := s.validate(); err != nil {
		return Config{}, err
	}
	exists, err := s.ensureOwnedDir(false)
	if err != nil {
		return Config{}, err
	}
	if !exists {
		return DefaultConfig(), nil
	}
	for range 20 {
		raw, missing, changed, err := s.readBounded()
		if err != nil {
			return Config{}, err
		}
		if missing {
			return DefaultConfig(), nil
		}
		if changed {
			continue
		}
		return decodeConfig(raw)
	}
	return Config{}, errors.New("config changed repeatedly while opening")
}

func (s *ConfigStore) Save(config Config) error {
	if err := s.validate(); err != nil {
		return err
	}
	// Validate before creating the owned directory or any temporary file.
	normalized, err := config.Normalized()
	if err != nil {
		return err
	}
	raw, err := encodeConfig(normalized)
	if err != nil {
		return err
	}
	if len(raw) > MaxConfigBytes {
		return errors.New("encoded config exceeds size limit")
	}
	if _, err := s.ensureOwnedDir(true); err != nil {
		return err
	}
	if info, err := os.Lstat(s.path); err == nil {
		if info.Mode()&fs.ModeSymlink != 0 {
			return errors.New("config path symlinks are not allowed")
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return s.atomicWrite(raw)
}

func (s *ConfigStore) validate() error {
	if s == nil || s.dir == "" || s.path == "" || s.openFile == nil || !filepath.IsAbs(s.dir) {
		return errors.New("valid config store is required")
	}
	return nil
}

func (s *ConfigStore) ensureOwnedDir(create bool) (bool, error) {
	info, err := os.Lstat(s.dir)
	if errors.Is(err, fs.ErrNotExist) {
		if !create {
			return false, nil
		}
		if err := os.Mkdir(s.dir, 0o700); err != nil {
			return false, err
		}
		info, err = os.Lstat(s.dir)
	}
	if err != nil {
		return false, err
	}
	if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
		return false, errors.New("owned config path must be a real directory")
	}
	if create {
		if err := os.Chmod(s.dir, 0o700); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (s *ConfigStore) atomicWrite(raw []byte) error {
	temp, err := os.CreateTemp(s.dir, "."+configFileName+".tmp-")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	committed := false
	defer func() {
		_ = temp.Close()
		if !committed {
			_ = os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(0o600); err != nil {
		return err
	}
	if _, err := temp.Write(raw); err != nil {
		return err
	}
	if err := temp.Sync(); err != nil {
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, s.path); err != nil {
		return err
	}
	committed = true
	// Directory sync is best-effort: rename already committed, so a sync error
	// cannot truthfully be returned as a pre-commit save failure.
	if parent, err := os.Open(s.dir); err == nil {
		_ = parent.Sync()
		_ = parent.Close()
	}
	return nil
}

func encodeConfig(config Config) ([]byte, error) {
	var encoded bytes.Buffer
	encoder := newConfigEncoder(&encoded)
	if err := encoder.Encode(config); err != nil {
		return nil, fmt.Errorf("encode AI settings: %w", err)
	}
	return encoded.Bytes(), nil
}
