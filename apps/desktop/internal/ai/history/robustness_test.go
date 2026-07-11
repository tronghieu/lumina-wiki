package history

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestConcurrentSameAttemptStoresOnceAndIsIdempotent(t *testing.T) {
	base := t.TempDir()
	id := workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef")
	first, _ := NewHistoryStore(base, id)
	second, _ := NewHistoryStore(base, id)
	_ = first.SetEnabled(context.Background(), true)
	outcomes := make(chan AppendOutcome, 2)
	errorsSeen := make(chan error, 2)
	var wait sync.WaitGroup
	for _, store := range []*HistoryStore{first, second} {
		wait.Add(1)
		go func() {
			defer wait.Done()
			outcome, err := store.Append(context.Background(), validRecord("conversation-a", "attempt-a"))
			outcomes <- outcome
			errorsSeen <- err
		}()
	}
	wait.Wait()
	close(outcomes)
	close(errorsSeen)
	for err := range errorsSeen {
		if err != nil {
			t.Fatalf("concurrent append: %v", err)
		}
	}
	counts := map[AppendOutcome]int{}
	for outcome := range outcomes {
		counts[outcome]++
	}
	if counts[AppendStored] != 1 || counts[AppendIdempotent] != 1 {
		t.Fatalf("unexpected outcomes: %#v", counts)
	}
}

func TestAtomicFailurePreservesOldConversationAndCleansTemp(t *testing.T) {
	store := enabledTestStore(t)
	ctx := context.Background()
	if _, err := store.Append(ctx, validRecord("conversation-a", "attempt-a")); err != nil {
		t.Fatalf("initial append: %v", err)
	}
	store.renameRoot = func(*os.Root, string, string) error { return errors.New("injected") }
	retry := validRecord("conversation-a", "attempt-b")
	retry.RetryOfAttemptID, retry.UserMessage = "attempt-a", ""
	for range 25 {
		if _, err := store.Append(ctx, retry); err == nil {
			t.Fatal("expected injected commit failure")
		}
	}
	store.renameRoot = func(root *os.Root, oldName, newName string) error { return root.Rename(oldName, newName) }
	records, err := store.Load(ctx, "conversation-a")
	if err != nil || len(records) != 1 || records[0].AttemptID != "attempt-a" {
		t.Fatalf("old conversation not preserved: %#v %v", records, err)
	}
	entries, _ := os.ReadDir(store.workspaceDir)
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp-") {
			t.Fatalf("temporary file leaked: %s", entry.Name())
		}
	}
}

func TestLoadRejectsDuplicateJSONAndRetryCycle(t *testing.T) {
	store := enabledTestStore(t)
	path := store.conversationPath("conversation-a")
	duplicate := `{"schemaVersion":1,"schemaVersion":1}` + "\n"
	if err := os.WriteFile(path, []byte(duplicate), 0o600); err != nil {
		t.Fatalf("write duplicate fixture: %v", err)
	}
	if _, err := store.Load(context.Background(), "conversation-a"); err == nil {
		t.Fatal("expected duplicate JSON rejection")
	}
	a := validRecord("conversation-a", "attempt-a")
	b := validRecord("conversation-a", "attempt-b")
	a.RetryOfAttemptID, a.UserMessage = "attempt-b", ""
	b.RetryOfAttemptID, b.UserMessage = "attempt-a", ""
	rawA, _ := encodeRecord(a)
	rawB, _ := encodeRecord(b)
	if err := os.WriteFile(path, append(append(rawA, '\n'), append(rawB, '\n')...), 0o600); err != nil {
		t.Fatalf("write cycle fixture: %v", err)
	}
	if _, err := store.Load(context.Background(), "conversation-a"); err == nil {
		t.Fatal("expected retry cycle rejection")
	}
}

func TestPersistentKernelLockReleasedWhenProcessDies(t *testing.T) {
	base := t.TempDir()
	command := exec.Command(os.Args[0], "-test.run=TestHistoryLockHelperProcess", "--", base)
	stdout, err := command.StdoutPipe()
	if err != nil || command.Start() != nil {
		t.Fatalf("start helper: %v", err)
	}
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || scanner.Text() != "READY" {
		_ = command.Process.Kill()
		t.Fatal("helper did not acquire lock")
	}
	store, _ := NewHistoryStore(base, workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef"))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if _, err := store.acquireAdvisory(ctx); err == nil {
		t.Fatal("parent unexpectedly acquired held lock")
	}
	_ = command.Process.Kill()
	_ = command.Wait()
	release, err := store.acquireAdvisory(context.Background())
	if err != nil {
		t.Fatalf("kernel did not release crashed lock: %v", err)
	}
	release()
	info, err := os.Lstat(store.lockPath)
	if err != nil || !info.Mode().IsRegular() {
		t.Fatal("persistent lock file missing or invalid")
	}
}

func TestHistoryLockHelperProcess(t *testing.T) {
	if len(os.Args) < 2 || os.Args[len(os.Args)-2] != "--" {
		return
	}
	base := os.Args[len(os.Args)-1]
	store, err := NewHistoryStore(base, workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef"))
	if err != nil {
		os.Exit(2)
	}
	release, err := store.acquireAdvisory(context.Background())
	if err != nil {
		os.Exit(3)
	}
	defer release()
	fmt.Println("READY")
	for {
		time.Sleep(time.Hour)
	}
}

func TestLockSymlinkRejected(t *testing.T) {
	store := newTestStore(t)
	_, _ = store.ensureDirs(true)
	if err := os.MkdirAll(filepath.Dir(store.lockPath), 0o700); err != nil {
		t.Fatalf("create lock directory: %v", err)
	}
	target := filepath.Join(t.TempDir(), "outside-lock")
	_ = os.WriteFile(target, nil, 0o600)
	if err := os.Symlink(target, store.lockPath); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := store.acquireAdvisory(context.Background()); err == nil {
		t.Fatal("expected lock symlink rejection")
	}
}
