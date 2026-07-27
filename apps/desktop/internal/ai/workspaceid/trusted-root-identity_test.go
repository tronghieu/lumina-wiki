package workspaceid

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTrustedRootIdentityReturnsConfirmedHandleIdentity(t *testing.T) {
	root := makeWorkspace(t)
	manager, err := NewManager(t.TempDir(), Options{})
	if err != nil {
		t.Fatal(err)
	}
	decision, err := manager.BeginAttach(root)
	if err != nil {
		t.Fatal(err)
	}
	id, err := manager.ConfirmAttach(decision.Token)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := manager.TrustedRootIdentity(id, decision.CanonicalPath)
	if err != nil || expected == nil || !expected.IsDir() {
		t.Fatalf("trusted identity = %#v, %v", expected, err)
	}
	current, err := os.Stat(root)
	if err != nil || !os.SameFile(expected, current) {
		t.Fatalf("identity does not match confirmed root: %v", err)
	}
	oldRoot := root + "-old"
	if err := os.Rename(root, oldRoot); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	afterReplacement, err := manager.TrustedRootIdentity(id, decision.CanonicalPath)
	if err != nil || !os.SameFile(expected, afterReplacement) {
		t.Fatalf("held identity changed with path replacement: %v", err)
	}
	replacement, err := os.Stat(root)
	if err != nil || os.SameFile(afterReplacement, replacement) {
		t.Fatalf("replacement mistaken for confirmed identity: %v", err)
	}
}

func TestTrustedRootIdentityRejectsInvalidOrUnavailableEvidenceSafely(t *testing.T) {
	root := makeWorkspace(t)
	manager, err := NewManager(t.TempDir(), Options{})
	if err != nil {
		t.Fatal(err)
	}
	privateCause := "private-handle-cause"
	manager.trusted[pathKey(root)] = trustedEvidence{
		id:     WorkspaceID("ws_11111111111111111111111111111111"),
		handle: staticDirectoryHandle{err: errors.New(privateCause)},
	}
	cases := []struct {
		manager *Manager
		id      WorkspaceID
		path    string
	}{
		{nil, "ws_11111111111111111111111111111111", root},
		{manager, "bad", root},
		{manager, "ws_11111111111111111111111111111111", "relative"},
		{manager, "ws_22222222222222222222222222222222", root},
		{manager, "ws_11111111111111111111111111111111", root},
	}
	for _, test := range cases {
		info, err := test.manager.TrustedRootIdentity(test.id, test.path)
		if info != nil || !errors.Is(err, ErrTrustedWorkspaceUnavailable) {
			t.Fatalf("unsafe result = %#v, %v", info, err)
		}
		if strings.Contains(err.Error(), root) || strings.Contains(err.Error(), privateCause) {
			t.Fatalf("error leaked private detail: %v", err)
		}
	}
}

func TestTrustedRootIdentitySerializesStatWithCloseAndAdoption(t *testing.T) {
	for _, operation := range []string{"close", "adopt"} {
		t.Run(operation, func(t *testing.T) {
			root := makeWorkspace(t)
			info, err := os.Stat(root)
			if err != nil {
				t.Fatal(err)
			}
			manager, err := NewManager(t.TempDir(), Options{})
			if err != nil {
				t.Fatal(err)
			}
			id := WorkspaceID("ws_11111111111111111111111111111111")
			handle := newBlockingDirectoryHandle(info)
			manager.trusted[pathKey(root)] = trustedEvidence{id: id, handle: handle}
			result := make(chan error, 1)
			go func() { _, err := manager.TrustedRootIdentity(id, root); result <- err }()
			<-handle.statEntered
			done := make(chan struct{})
			go func() {
				if operation == "close" {
					_ = manager.Close()
				} else {
					manager.adoptTrusted(id, ownedCandidate{Candidate: Candidate{CanonicalPath: root}, handle: staticDirectoryHandle{info: info}})
				}
				close(done)
			}()
			select {
			case <-handle.closeEntered:
				t.Fatal("handle closed during Stat")
			case <-time.After(20 * time.Millisecond):
			}
			close(handle.releaseStat)
			if err := <-result; err != nil {
				t.Fatalf("trusted identity: %v", err)
			}
			<-done
			select {
			case <-handle.closeEntered:
			case <-time.After(time.Second):
				t.Fatal("retired handle was not closed")
			}
		})
	}
}

type staticDirectoryHandle struct {
	info os.FileInfo
	err  error
}

func (handle staticDirectoryHandle) Stat() (os.FileInfo, error) { return handle.info, handle.err }
func (staticDirectoryHandle) Close() error                      { return nil }

type blockingDirectoryHandle struct {
	info         os.FileInfo
	statEntered  chan struct{}
	releaseStat  chan struct{}
	closeEntered chan struct{}
	statOnce     sync.Once
	closeOnce    sync.Once
}

func newBlockingDirectoryHandle(info os.FileInfo) *blockingDirectoryHandle {
	return &blockingDirectoryHandle{info: info, statEntered: make(chan struct{}), releaseStat: make(chan struct{}), closeEntered: make(chan struct{})}
}

func (handle *blockingDirectoryHandle) Stat() (os.FileInfo, error) {
	handle.statOnce.Do(func() { close(handle.statEntered) })
	<-handle.releaseStat
	return handle.info, nil
}

func (handle *blockingDirectoryHandle) Close() error {
	handle.closeOnce.Do(func() { close(handle.closeEntered) })
	return nil
}

func TestTrustedRootIdentityUsesCanonicalPathKey(t *testing.T) {
	root := makeWorkspace(t)
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(root, alias); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	manager, _ := NewManager(t.TempDir(), Options{})
	id := WorkspaceID("ws_11111111111111111111111111111111")
	info, _ := os.Stat(root)
	manager.trusted[pathKey(root)] = trustedEvidence{id: id, handle: staticDirectoryHandle{info: info}}
	if _, err := manager.TrustedRootIdentity(id, alias); !errors.Is(err, ErrTrustedWorkspaceUnavailable) {
		t.Fatalf("noncanonical alias key accepted: %v", err)
	}
}
