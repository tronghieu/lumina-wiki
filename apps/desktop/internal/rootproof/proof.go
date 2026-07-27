// Package rootproof owns the held operating-system root used by workspace
// operations. It intentionally has no dependencies on higher-level packages.
package rootproof

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"
)

const MaxPathBytes = 32 * 1024

// Version identifies the in-memory proof representation.
type Version uint8

const CurrentVersion Version = 1

type proofState struct {
	mu       sync.RWMutex
	root     *os.Root
	expected os.FileInfo
	platform platformProof
	path     string
	closed   bool
}

// RootProof is a copyable handle to one held, identity-checked directory root.
// Copies share ownership; closing any copy invalidates all of them.
type RootProof struct {
	state *proofState
}

// Open verifies path and holds an os.Root for its directory identity.
func Open(path string) (RootProof, error) {
	if path == "" ||
		!utf8.ValidString(path) ||
		strings.IndexByte(path, 0) >= 0 ||
		len(path) > MaxPathBytes ||
		!filepath.IsAbs(path) ||
		filepath.Clean(path) != path {
		return RootProof{}, errors.New("canonical absolute root is required")
	}
	root, expected, platform, err := openPlatformRoot(path)
	if err != nil {
		return RootProof{}, err
	}
	return RootProof{state: &proofState{
		root:     root,
		expected: expected,
		platform: platform,
		path:     path,
	}}, nil
}

// Version returns the proof representation version, or zero for no proof.
func (p RootProof) Version() Version {
	if p.state == nil {
		return 0
	}
	return CurrentVersion
}

// Signature returns the versioned platform identity captured from the held
// directory. It is backend evidence and is never serialized by this package.
func (p RootProof) Signature() (string, bool) {
	if p.state == nil {
		return "", false
	}
	p.state.mu.RLock()
	defer p.state.mu.RUnlock()
	if p.state.closed {
		return "", false
	}
	return p.state.platform.signature()
}

// Path returns the canonical absolute spelling proven by Open.
func (p RootProof) Path() string {
	if p.state == nil {
		return ""
	}
	p.state.mu.RLock()
	defer p.state.mu.RUnlock()
	if p.state.closed {
		return ""
	}
	return p.state.path
}

// Validate confirms that the held root still refers to the opened directory.
func (p RootProof) Validate() error {
	if p.state == nil {
		return errors.New("root proof is absent")
	}
	p.state.mu.RLock()
	defer p.state.mu.RUnlock()
	if p.state.closed || p.state.root == nil {
		return errors.New("root proof is closed")
	}
	return p.state.validateLocked()
}

// OpenRoot returns a new caller-owned os.Root after proving that its opened
// handle has the same directory identity as this proof. The proof's original
// held root remains private and open.
func (p RootProof) OpenRoot() (*os.Root, error) {
	if p.state == nil {
		return nil, errors.New("root proof is absent")
	}
	p.state.mu.RLock()
	defer p.state.mu.RUnlock()
	if p.state.closed || p.state.root == nil {
		return nil, errors.New("root proof is closed")
	}
	if err := p.state.validateLocked(); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(p.state.path)
	if err != nil {
		return nil, errors.New("proven root cannot be opened")
	}
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(opened, p.state.expected) {
		_ = root.Close()
		return nil, errors.New("root changed while opening")
	}
	if err := p.state.validateLocked(); err != nil {
		_ = root.Close()
		return nil, err
	}
	return root, nil
}

func (state *proofState) validateLocked() error {
	current, err := os.Lstat(state.path)
	if err != nil || !current.IsDir() || current.Mode()&fs.ModeSymlink != 0 ||
		!os.SameFile(current, state.expected) {
		return errors.New("root path changed")
	}
	opened, err := state.root.Stat(".")
	if err != nil || !opened.IsDir() || opened.Mode()&fs.ModeSymlink != 0 ||
		!os.SameFile(opened, state.expected) {
		return errors.New("root proof changed")
	}
	if err := state.platform.validate(state.path); err != nil {
		return err
	}
	return nil
}

// Close releases the held operating-system root. It is safe to call repeatedly.
func (p RootProof) Close() error {
	if p.state == nil {
		return nil
	}
	p.state.mu.Lock()
	defer p.state.mu.Unlock()
	if p.state.closed {
		return nil
	}
	p.state.closed = true
	platformErr := p.state.platform.close()
	if p.state.root == nil {
		return platformErr
	}
	err := p.state.root.Close()
	p.state.root = nil
	if platformErr != nil {
		return platformErr
	}
	return err
}
