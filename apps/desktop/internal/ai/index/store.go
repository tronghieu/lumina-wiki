package index

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

const (
	ownedCacheLeaf = "lumina-wiki-desktop"
	indexesLeaf    = "indexes"
	manifestName   = "manifest.json"
	lockName       = ".index.lock"
)

type Store struct {
	baseDir, workspaceDir, workspaceID, key                           string
	baseIdentity, desktopIdentity, indexesIdentity, workspaceIdentity os.FileInfo
	identityMu                                                        sync.Mutex
	rename                                                            func(*os.Root, string, string) error
	syncRoot                                                          func(*os.Root) error
	protect                                                           func(*os.File, os.FileMode) error
	validate                                                          func(*os.File) error
	openLock                                                          func(*os.Root, string, int, os.FileMode) (*os.File, error)
	remove                                                            func(*os.Root, string) error
	searchAfterOpen                                                   func()
}

func NewStore(id workspaceid.WorkspaceID) (*Store, error) {
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		return nil, errors.New("semantic index cache is unavailable")
	}
	base = filepath.Clean(base)
	if err := os.MkdirAll(base, 0o700); err != nil {
		return nil, errors.New("semantic index cache is unavailable")
	}
	return newStoreAt(base, id)
}

func newTestStore(base string, id workspaceid.WorkspaceID) (*Store, error) {
	return newStoreAt(base, id)
}

func newStoreAt(base string, id workspaceid.WorkspaceID) (*Store, error) {
	if base == "" || !filepath.IsAbs(base) || filepath.Clean(base) != base || !id.Valid() {
		return nil, errors.New("semantic index location is invalid")
	}
	info, err := os.Lstat(base)
	if err != nil || !info.IsDir() || info.Mode()&fs.ModeSymlink != 0 {
		return nil, errors.New("semantic index cache base is invalid")
	}
	dir := filepath.Join(base, ownedCacheLeaf, indexesLeaf, string(id))
	store := &Store{baseDir: base, workspaceDir: dir, workspaceID: string(id), key: dir, baseIdentity: info,
		rename: platformReplaceIndexFile, syncRoot: platformSyncIndexRoot, protect: platformProtectIndexHandle,
		validate: platformValidateIndexProtectedHandle,
		openLock: func(root *os.Root, name string, flag int, mode os.FileMode) (*os.File, error) {
			return root.OpenFile(name, flag, mode)
		},
		remove: func(root *os.Root, name string) error { return root.Remove(name) }}
	root, err := store.openRoot()
	if err != nil {
		return nil, err
	}
	_ = root.Close()
	return store, nil
}
