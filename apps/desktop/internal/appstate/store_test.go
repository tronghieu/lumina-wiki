package appstate

import (
	"context"
	"errors"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStoreRoundTripOrderingEvictionAndRevision(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	initial, err := store.Snapshot(ctx)
	if err != nil || initial.SchemaVersion != CurrentSchemaVersion || initial.Revision != 0 ||
		len(initial.Recent) != 0 || len(initial.Views) != 0 {
		t.Fatalf("initial=%#v err=%v", initial, err)
	}
	base := time.Date(2026, 7, 27, 1, 2, 3, 0, time.UTC)
	for index := byte(0); index < MaxRecentWorkspaces+1; index++ {
		if err := store.RecordActivation(ctx, testWorkspaceID(index), base.Add(time.Duration(index)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := store.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Recent) != MaxRecentWorkspaces || snapshot.Revision != MaxRecentWorkspaces+1 {
		t.Fatalf("snapshot=%#v", snapshot)
	}
	if snapshot.Recent[0].WorkspaceID != testWorkspaceID(MaxRecentWorkspaces) ||
		snapshot.Recent[len(snapshot.Recent)-1].WorkspaceID != testWorkspaceID(1) {
		t.Fatalf("order/eviction=%#v", snapshot.Recent)
	}
	if snapshot.LastWorkspaceID != testWorkspaceID(MaxRecentWorkspaces) {
		t.Fatalf("last=%q", snapshot.LastWorkspaceID)
	}
}

func TestSaveViewAndRemoveRecentClearOnlyOwnedReferences(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	id := testWorkspaceID(1)
	if err := store.RecordActivation(ctx, id, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	view := WorkspaceView{
		Focus: FocusNote,
		Artifact: &ArtifactLocatorV1{
			Version: 1, Kind: ArtifactWikiNote, RelativePath: "wiki/concepts/private-note.md",
		},
	}
	if err := store.SaveView(ctx, id, view); err != nil {
		t.Fatal(err)
	}
	if err := store.RemoveRecent(ctx, id); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Recent) != 0 || len(snapshot.Views) != 0 || snapshot.LastWorkspaceID != "" {
		t.Fatalf("removed state=%#v", snapshot)
	}
	if err := store.RemoveRecent(ctx, id); err != nil {
		t.Fatalf("idempotent remove: %v", err)
	}
}

func TestStoreRejectsInvalidAndNonCanonicalStateWithoutMutation(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	id := testWorkspaceID(1)
	if err := store.RecordActivation(ctx, id, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	before, err := store.raw.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordActivation(ctx, "invalid", time.Now().UTC()); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("invalid ID error=%v", err)
	}
	if err := store.SaveView(ctx, testWorkspaceID(2), WorkspaceView{Focus: FocusChat}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("unknown view ID error=%v", err)
	}
	after, err := store.raw.Read(ctx)
	if err != nil || string(after.Data) != string(before.Data) {
		t.Fatalf("state mutated: %v", err)
	}

	corrupt := []byte(`{"schemaVersion":1,"revision":1,"recent":[],"recent":[],"views":{}}`)
	if err := store.raw.Write(ctx, corrupt); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Snapshot(ctx); !errors.Is(err, ErrCorruptState) {
		t.Fatalf("duplicate state error=%v", err)
	}
	preserved, _ := store.raw.Read(ctx)
	if string(preserved.Data) != string(corrupt) {
		t.Fatal("corrupt state was rewritten")
	}
}

func TestEncodedStateContainsNoAbsolutePaths(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	id := testWorkspaceID(1)
	if err := store.RecordActivation(ctx, id, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveView(ctx, id, WorkspaceView{
		Focus:    FocusNote,
		Artifact: &ArtifactLocatorV1{Version: 1, Kind: ArtifactWikiNote, RelativePath: "wiki/a.md"},
	}); err != nil {
		t.Fatal(err)
	}
	raw, err := store.raw.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw.Data)
	if strings.Contains(text, t.TempDir()) || strings.Contains(text, `:\`) || strings.Contains(text, `"/`) {
		t.Fatalf("encoded state exposes absolute path: %s", text)
	}
}

func TestConcurrentActivationsAreAtomicAndBounded(t *testing.T) {
	base := t.TempDir()
	store, err := NewStore(base)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewStore(base)
	if err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	for index := byte(0); index < 16; index++ {
		wait.Add(1)
		go func(index byte) {
			defer wait.Done()
			target := store
			if index%2 == 1 {
				target = second
			}
			if err := target.RecordActivation(context.Background(), testWorkspaceID(index),
				time.Date(2026, 7, 27, 0, int(index), 0, 0, time.UTC)); err != nil {
				t.Errorf("record %d: %v", index, err)
			}
		}(index)
	}
	wait.Wait()
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Recent) != MaxRecentWorkspaces || snapshot.Revision != 16 {
		t.Fatalf("snapshot=%#v", snapshot)
	}
}

func TestOlderRepeatActivationCannotRegressRecency(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := testWorkspaceID(1)
	newer := time.Date(2026, 7, 27, 2, 0, 0, 0, time.UTC)
	if err := store.RecordActivation(context.Background(), id, newer); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordActivation(context.Background(), id, newer.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Snapshot(context.Background())
	if err != nil || len(snapshot.Recent) != 1 || !snapshot.Recent[0].ActivatedAt.Equal(newer) {
		t.Fatalf("snapshot=%#v err=%v", snapshot, err)
	}
}

func TestDecodeRejectsStrictJSONAndInvalidContent(t *testing.T) {
	id := testWorkspaceID(1)
	validTime := "2026-07-27T00:00:00Z"
	cases := map[string]string{
		"unknown field": `{"schemaVersion":1,"revision":0,"recent":[],"views":{},"extra":true}`,
		"newer schema":  `{"schemaVersion":2,"revision":0,"recent":[],"views":{}}`,
		"duplicate ID": `{"schemaVersion":1,"revision":0,"recent":[` +
			`{"workspaceId":"` + string(id) + `","activatedAt":"` + validTime + `"},` +
			`{"workspaceId":"` + string(id) + `","activatedAt":"` + validTime + `"}],"views":{}}`,
		"trailing data": `{"schemaVersion":1,"revision":0,"recent":[],"views":{}} true`,
		"absolute locator": `{"schemaVersion":1,"revision":0,"recent":[` +
			`{"workspaceId":"` + string(id) + `","activatedAt":"` + validTime + `"}],` +
			`"views":{"` + string(id) + `":{"focus":"note","artifact":` +
			`{"version":1,"kind":"wiki_note","relativePath":"/wiki/a.md"}}}}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeSnapshot([]byte(raw)); !errors.Is(err, ErrCorruptState) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestStoreRejectsOversizeJSON(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.raw.Write(context.Background(), []byte(strings.Repeat("x", MaxStateBytes+1))); err == nil {
		t.Fatal("oversize raw state accepted")
	}
}

func TestCorruptStateIsQuarantinedOnlyByExplicitReset(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	corrupt := []byte(`{"schemaVersion":1,"revision":"broken"}`)
	if err := store.raw.Write(ctx, corrupt); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Snapshot(ctx); !errors.Is(err, ErrCorruptState) {
		t.Fatalf("snapshot error=%v", err)
	}
	if quarantine, _ := store.quarantine.Read(ctx); quarantine.Exists {
		t.Fatal("corrupt state quarantined without explicit reset")
	}
	outcome, err := store.ResetRecentViewState(ctx)
	if err != nil || outcome != Reset {
		t.Fatalf("reset=%s err=%v", outcome, err)
	}
	backup, err := store.quarantine.Read(ctx)
	if err != nil || !backup.Exists || string(backup.Data) != string(corrupt) {
		t.Fatalf("backup=%#v err=%v", backup, err)
	}
	snapshot, err := store.Snapshot(ctx)
	if err != nil || snapshot.Revision != 0 || len(snapshot.Recent) != 0 {
		t.Fatalf("reset snapshot=%#v err=%v", snapshot, err)
	}
	outcome, err = store.ResetRecentViewState(ctx)
	if err != nil || outcome != AlreadyReset {
		t.Fatalf("second reset=%s err=%v", outcome, err)
	}
}

func TestResetFailurePreservesCorruptPrimary(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	corrupt := []byte(`{"bad":true}`)
	if err := store.raw.Write(ctx, corrupt); err != nil {
		t.Fatal(err)
	}
	store.resetBeforeDelete = func() error { return errors.New("injected reset failure") }
	outcome, err := store.ResetRecentViewState(ctx)
	if err == nil || outcome != FailedPreserved {
		t.Fatalf("outcome=%s err=%v", outcome, err)
	}
	primary, readErr := store.raw.Read(ctx)
	if readErr != nil || !primary.Exists || string(primary.Data) != string(corrupt) {
		t.Fatalf("primary=%#v err=%v", primary, readErr)
	}
}

func TestResetUnavailableIsDistinct(t *testing.T) {
	var store *Store
	outcome, err := store.ResetRecentViewState(context.Background())
	if outcome != ResetUnavailable || !errors.Is(err, ErrInvalidState) {
		t.Fatalf("outcome=%s err=%v", outcome, err)
	}
}

func TestResetConflictPreservesConcurrentActivation(t *testing.T) {
	base := t.TempDir()
	store, err := NewStore(base)
	if err != nil {
		t.Fatal(err)
	}
	other, err := NewStore(base)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	first := testWorkspaceID(1)
	second := testWorkspaceID(2)
	if err := store.RecordActivation(ctx, first, time.Date(2026, 7, 27, 1, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	reached := make(chan struct{})
	release := make(chan struct{})
	store.resetBeforeDelete = func() error {
		close(reached)
		<-release
		return nil
	}
	result := make(chan struct {
		outcome ResetOutcome
		err     error
	}, 1)
	go func() {
		outcome, err := store.ResetRecentViewState(ctx)
		result <- struct {
			outcome ResetOutcome
			err     error
		}{outcome: outcome, err: err}
	}()
	<-reached
	if err := other.RecordActivation(ctx, second, time.Date(2026, 7, 27, 2, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	close(release)
	reset := <-result
	if reset.outcome != FailedPreserved || reset.err == nil {
		t.Fatalf("reset=%s err=%v", reset.outcome, reset.err)
	}
	snapshot, err := store.Snapshot(ctx)
	if err != nil || len(snapshot.Recent) != 2 || snapshot.Recent[0].WorkspaceID != second {
		t.Fatalf("snapshot=%#v err=%v", snapshot, err)
	}
}

func TestRevisionOverflowIsRejectedWithoutMutation(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := testWorkspaceID(1)
	raw := `{"schemaVersion":1,"revision":18446744073709551615,"recent":[` +
		`{"workspaceId":"` + string(id) + `","activatedAt":"2026-07-27T00:00:00Z"}],"views":{}}`
	if err := store.raw.Write(context.Background(), []byte(raw)); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordActivation(context.Background(), id, time.Now().UTC()); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("error=%v", err)
	}
	preserved, err := store.raw.Read(context.Background())
	if err != nil || string(preserved.Data) != raw {
		t.Fatalf("preserved=%q err=%v", preserved.Data, err)
	}
}

func TestAppStateFilesUsePrivateModes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows protection is validated by appprivate handle-DACL tests")
	}
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordActivation(context.Background(), testWorkspaceID(1), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(store.rawStatePathForTest())
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode=%v err=%v", info.Mode(), err)
	}
}
