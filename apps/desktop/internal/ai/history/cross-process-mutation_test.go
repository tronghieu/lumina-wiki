package history

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestTwoProcessesAppendDifferentAttemptsWithoutLostUpdate(t *testing.T) {
	base := t.TempDir()
	store, _ := NewHistoryStore(base, workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef"))
	if err := store.SetEnabled(context.Background(), true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	commands := []*exec.Cmd{
		exec.Command(os.Args[0], "-test.run=TestCrossProcessAppendHelper", "--", base, "attempt-a"),
		exec.Command(os.Args[0], "-test.run=TestCrossProcessAppendHelper", "--", base, "attempt-b"),
	}
	for _, command := range commands {
		if err := command.Start(); err != nil {
			t.Fatalf("start helper: %v", err)
		}
	}
	for _, command := range commands {
		if err := command.Wait(); err != nil {
			t.Fatalf("append helper: %v", err)
		}
	}
	records, err := store.Load(context.Background(), "conversation-a")
	if err != nil || len(records) != 2 {
		t.Fatalf("cross-process append lost update: %#v %v", records, err)
	}
}

func TestCrossProcessAppendHelper(t *testing.T) {
	if len(os.Args) < 4 || os.Args[len(os.Args)-3] != "--" {
		return
	}
	base, attempt := os.Args[len(os.Args)-2], os.Args[len(os.Args)-1]
	store, err := NewHistoryStore(base, workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef"))
	if err != nil {
		os.Exit(2)
	}
	outcome, err := store.Append(context.Background(), validRecord("conversation-a", attempt))
	if err != nil || (outcome != AppendStored && outcome != AppendIdempotent) {
		fmt.Fprintln(os.Stderr, "append failed")
		os.Exit(3)
	}
}
