// Package appprivate provides bounded, private, atomic storage for app-local
// state. Callers own the state format and its semantic validation.
package appprivate

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const (
	appDirectoryName   = "lumina-wiki-desktop"
	stateDirectoryName = "private-state"

	// MaxStateBytes is the largest per-store bound accepted by NewStore.
	MaxStateBytes = 4 * 1024 * 1024
	maxStoreName  = 64
)

var (
	ErrInvalidConfiguration = errors.New("private state configuration is invalid")
	ErrInvalidState         = errors.New("private state is invalid")
	ErrStateTooLarge        = errors.New("private state exceeds size limit")
	ErrUnsafeState          = errors.New("private state is unsafe")
	ErrStateChanged         = errors.New("private state changed during operation")
	ErrLockUnsupported      = errors.New("private state locking is unsupported")
)

// Snapshot is the raw state observed while holding the store's cross-process
// lock. Data is owned by the caller.
type Snapshot struct {
	Data   []byte
	Exists bool
}

// Mutation describes the result of an Update callback. Delete takes precedence
// over Data.
type Mutation struct {
	Data   []byte
	Delete bool
}

// Store owns one named file and its persistent cross-process lock.
type Store struct {
	baseDir   string
	appDir    string
	stateDir  string
	statePath string
	lockPath  string
	name      string
	maxBytes  int

	renameRoot       func(*os.Root, string, string) error
	syncRoot         func(*os.Root) error
	stateOpenHook    func()
	appDirOpenHook   func()
	stateDirOpenHook func()
	beforeCommitHook func()
}

// NewStore configures one domain-neutral app-local state file. Name becomes a
// private filename and must be a lowercase ASCII kebab-case token.
func NewStore(configBase, name string, maxBytes int) (*Store, error) {
	if configBase == "" || !filepath.IsAbs(configBase) || filepath.Clean(configBase) != configBase ||
		!validStoreName(name) || maxBytes < 1 || maxBytes > MaxStateBytes {
		return nil, ErrInvalidConfiguration
	}
	appDir := filepath.Join(configBase, appDirectoryName)
	stateDir := filepath.Join(appDir, stateDirectoryName)
	return &Store{
		baseDir:          configBase,
		appDir:           appDir,
		stateDir:         stateDir,
		statePath:        filepath.Join(stateDir, name+".json"),
		lockPath:         filepath.Join(stateDir, "."+name+".lock"),
		name:             name,
		maxBytes:         maxBytes,
		renameRoot:       func(root *os.Root, oldName, newName string) error { return root.Rename(oldName, newName) },
		syncRoot:         syncRootDirectory,
		stateOpenHook:    func() {},
		appDirOpenHook:   func() {},
		stateDirOpenHook: func() {},
		beforeCommitHook: func() {},
	}, nil
}

func validStoreName(name string) bool {
	if name == "" || len(name) > maxStoreName || name[0] == '-' || name[len(name)-1] == '-' ||
		strings.Contains(name, "--") {
		return false
	}
	for _, char := range name {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return false
		}
	}
	return true
}

func (store *Store) stateName() string { return store.name + ".json" }
func (store *Store) lockName() string  { return "." + store.name + ".lock" }
func (store *Store) tempPrefix() string {
	return "." + store.name + ".tmp-"
}

// Read returns the current raw state, or Exists=false when no state was saved.
func (store *Store) Read(ctx context.Context) (Snapshot, error) {
	lease, release, err := store.acquireLease(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	defer release()
	snapshot, _, err := store.readSnapshot(lease)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.Data = append([]byte(nil), snapshot.Data...)
	return snapshot, nil
}

// Write atomically replaces the current state.
func (store *Store) Write(ctx context.Context, data []byte) error {
	_, err := store.Update(ctx, func(Snapshot) (Mutation, error) {
		return Mutation{Data: data}, nil
	})
	return err
}

// Remove deletes the current state while preserving the persistent lock.
func (store *Store) Remove(ctx context.Context) error {
	_, err := store.Update(ctx, func(Snapshot) (Mutation, error) {
		return Mutation{Delete: true}, nil
	})
	return err
}

// Update performs one locked read-modify-write transaction. The callback is
// invoked exactly once and no change is committed when it returns an error.
func (store *Store) Update(ctx context.Context, update func(Snapshot) (Mutation, error)) (Snapshot, error) {
	if update == nil {
		return Snapshot{}, ErrInvalidConfiguration
	}
	lease, release, err := store.acquireLease(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	defer release()
	if err := store.cleanupTemps(lease); err != nil {
		return Snapshot{}, err
	}
	current, identity, err := store.readSnapshot(lease)
	if err != nil {
		return Snapshot{}, err
	}
	current.Data = append([]byte(nil), current.Data...)
	mutation, err := update(current)
	if err != nil {
		return Snapshot{}, err
	}
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	if mutation.Delete {
		if err := store.removeState(lease, identity); err != nil {
			return Snapshot{}, err
		}
		return Snapshot{}, nil
	}
	if len(mutation.Data) == 0 {
		return Snapshot{}, ErrInvalidState
	}
	if len(mutation.Data) > store.maxBytes {
		return Snapshot{}, ErrStateTooLarge
	}
	data := append([]byte(nil), mutation.Data...)
	if err := store.atomicWrite(lease, identity, data); err != nil {
		return Snapshot{}, err
	}
	return Snapshot{Data: data, Exists: true}, nil
}
