package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appstate"
)

type failingActivationState struct {
	*appstate.Store
}

type blockedActivationState struct {
	*appstate.Store
	called chan struct{}
}

func (state *blockedActivationState) RecordActivation(
	ctx context.Context,
	_ workspaceid.WorkspaceID,
	_ time.Time,
) error {
	close(state.called)
	<-ctx.Done()
	return ctx.Err()
}

func (state *failingActivationState) RecordActivation(
	context.Context,
	workspaceid.WorkspaceID,
	time.Time,
) error {
	return errors.New("private app-state failure")
}

func TestLibraryFacadeListsPathlessRecentAndDerivesViewWorkspaceFromSession(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	state, err := appstate.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.libraryState = state
	location, err := fixture.service.BeginCreateLibrary(context.Background(), "Continuity")
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := fixture.service.PrepareCreateLibrary(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	commit, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil || commit.Capability == nil || commit.ContinuityWarning {
		t.Fatalf("commit = %#v, %v", commit, err)
	}

	locator := &ArtifactLocatorV1DTO{
		Version: ArtifactLocatorVersion, Kind: ArtifactKindWikiNote,
		RelativePath: "wiki/concepts/focus.md",
	}
	view, err := fixture.service.SaveWorkspaceView(context.Background(), SaveWorkspaceViewRequestDTO{
		Session: SessionReferenceDTO{
			SessionID: commit.Capability.SessionID, Generation: commit.Capability.Generation,
		},
		Focus: WorkspaceFocusNote, Artifact: locator,
	})
	if err != nil || view.Focus != WorkspaceFocusNote || view.Artifact == nil {
		t.Fatalf("view = %#v, %v", view, err)
	}
	recent, err := fixture.service.ListRecentLibraries(context.Background())
	if err != nil || len(recent.Libraries) != 1 {
		t.Fatalf("recent = %#v, %v", recent, err)
	}
	item := recent.Libraries[0]
	if item.WorkspaceID != commit.Capability.WorkspaceID || item.Label != "Continuity" ||
		item.Status != RecentLibraryAvailable || item.Focus != WorkspaceFocusNote {
		t.Fatalf("recent item = %#v", item)
	}
	raw, err := json.Marshal(recent)
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(fixture.parent, "Continuity")
	if strings.Contains(string(raw), root) || strings.Contains(string(raw), "relativePath") {
		t.Fatalf("recent leaked root or locator: %s", raw)
	}
}

func TestRemoveRecentClearsOnlyRecentAndViewReferences(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	state, err := appstate.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.libraryState = state
	location, _ := fixture.service.BeginCreateLibrary(context.Background(), "Removable")
	prepared, _ := fixture.service.PrepareCreateLibrary(context.Background(), location)
	commit, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil {
		t.Fatal(err)
	}
	result, err := fixture.service.RemoveRecentLibrary(context.Background(), RecentLibraryRequestDTO{
		WorkspaceID: commit.Capability.WorkspaceID,
	})
	if err != nil || !result.Removed {
		t.Fatalf("remove = %#v, %v", result, err)
	}
	snapshot, err := state.Snapshot(context.Background())
	if err != nil || len(snapshot.Recent) != 0 || len(snapshot.Views) != 0 {
		t.Fatalf("state = %#v, %v", snapshot, err)
	}
	identity, err := fixture.service.attacher.(WorkspaceRecentResolver).ResolveRecent(
		[]workspaceid.WorkspaceID{commit.Capability.WorkspaceID},
	)
	if err != nil || len(identity) != 1 {
		t.Fatalf("identity was removed: %#v, %v", identity, err)
	}
}

func TestPrepareRestoreRecentLibraryReusesPreparedPipelineAndViewFocus(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	state, err := appstate.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.libraryState = state
	location, _ := fixture.service.BeginCreateLibrary(context.Background(), "Restorable")
	prepared, _ := fixture.service.PrepareCreateLibrary(context.Background(), location)
	commit, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil {
		t.Fatal(err)
	}
	_, err = fixture.service.SaveWorkspaceView(context.Background(), SaveWorkspaceViewRequestDTO{
		Session: SessionReferenceDTO{
			SessionID: commit.Capability.SessionID, Generation: commit.Capability.Generation,
		},
		Focus: WorkspaceFocusNote,
		Artifact: &ArtifactLocatorV1DTO{
			Version: ArtifactLocatorVersion, Kind: ArtifactKindWikiNote,
			RelativePath: "wiki/concepts/restored.md",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	restored, err := fixture.service.PrepareRestoreRecentLibrary(
		context.Background(),
		RestoreRecentLibraryRequestDTO{WorkspaceID: commit.Capability.WorkspaceID},
	)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Prepared.Status != PreparationReady || restored.Prepared.PreparationToken == "" ||
		restored.Focus != WorkspaceFocusNote || restored.ArtifactStatus != ContinuityUnavailable {
		t.Fatalf("restored = %#v", restored)
	}
	if _, err := fixture.service.AbortPreparedLibrary(
		context.Background(), restored.Prepared.PreparationToken,
	); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareFindRecentLibraryBindsMovedSelectionToIntendedWorkspaceID(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	state, err := appstate.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.libraryState = state
	location, _ := fixture.service.BeginCreateLibrary(context.Background(), "Moved")
	prepared, _ := fixture.service.PrepareCreateLibrary(context.Background(), location)
	created, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(fixture.parent, "Moved")
	moved := filepath.Join(fixture.parent, "Moved Again")
	if err := os.Rename(original, moved); err != nil {
		t.Fatal(err)
	}
	fixture.authority.selection = DirectorySelection{Path: moved, Approved: true}

	found, err := fixture.service.PrepareFindRecentLibrary(
		context.Background(),
		FindRecentLibraryRequestDTO{WorkspaceID: created.Capability.WorkspaceID},
	)
	if err != nil || found.Prepared.Status != PreparationReady {
		t.Fatalf("found = %#v, %v", found, err)
	}
	committed, err := fixture.service.CommitPreparedLibrary(
		context.Background(), found.Prepared.PreparationToken,
	)
	if err != nil || committed.Capability == nil ||
		committed.Capability.WorkspaceID != created.Capability.WorkspaceID {
		t.Fatalf("committed = %#v, %v", committed, err)
	}
}

func TestActivationAppStateFailureKeepsUsableSessionWithWarning(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	state, err := appstate.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.libraryState = &failingActivationState{Store: state}
	location, _ := fixture.service.BeginCreateLibrary(context.Background(), "Warning")
	prepared, _ := fixture.service.PrepareCreateLibrary(context.Background(), location)
	commit, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil || commit.Capability == nil || !commit.ContinuityWarning ||
		commit.Status != CommitCreatedAndActive {
		t.Fatalf("commit = %#v, %v", commit, err)
	}
	lease, err := fixture.registry.Resolve(7, session.Reference{
		SessionID: commit.Capability.SessionID, Generation: commit.Capability.Generation,
	})
	if err != nil {
		t.Fatalf("active session unavailable: %v", err)
	}
	lease.Finish()
}

func TestActivationAppStateContentionIsBoundedAfterSessionCommit(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	state, err := appstate.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	blocked := &blockedActivationState{Store: state, called: make(chan struct{})}
	fixture.service.libraryState = blocked
	location, _ := fixture.service.BeginCreateLibrary(context.Background(), "Contended")
	prepared, _ := fixture.service.PrepareCreateLibrary(context.Background(), location)

	type outcome struct {
		commit ReadyCommitDTO
		err    error
	}
	completed := make(chan outcome, 1)
	go func() {
		commit, commitErr := fixture.service.CommitPreparedLibrary(
			context.Background(), prepared.PreparationToken,
		)
		completed <- outcome{commit: commit, err: commitErr}
	}()
	select {
	case <-blocked.called:
	case <-time.After(5 * time.Second):
		t.Fatal("activation recording was not attempted")
	}
	select {
	case result := <-completed:
		if result.err != nil || result.commit.Capability == nil ||
			!result.commit.ContinuityWarning || result.commit.Status != CommitCreatedAndActive {
			t.Fatalf("commit = %#v, %v", result.commit, result.err)
		}
		lease, resolveErr := fixture.registry.Resolve(7, session.Reference{
			SessionID:  result.commit.Capability.SessionID,
			Generation: result.commit.Capability.Generation,
		})
		if resolveErr != nil {
			t.Fatalf("committed session unavailable: %v", resolveErr)
		}
		lease.Finish()
	case <-time.After(time.Second):
		t.Fatal("post-commit continuity recording blocked the usable session")
	}
}

func TestResetRecentViewStateRequiresNativeConfirmationAndConsumesTokenOnce(t *testing.T) {
	service, authority, _, _, _, _ := newTestService(&callLog{})
	state, err := appstate.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service.libraryState = state
	if err := state.RecordActivation(context.Background(), testWorkspaceID, service.now()); err != nil {
		t.Fatal(err)
	}

	cancelled, err := service.BeginResetRecentViewState(context.Background())
	if err != nil || cancelled.Status != ResetConfirmationCancelled || cancelled.Token != "" {
		t.Fatalf("cancelled = %#v, %v", cancelled, err)
	}
	authority.resetOK = true
	confirmation, err := service.BeginResetRecentViewState(context.Background())
	if err != nil || confirmation.Status != ResetConfirmationReady || confirmation.Token == "" {
		t.Fatalf("confirmation = %#v, %v", confirmation, err)
	}
	result, err := service.ResetRecentViewState(context.Background(), confirmation.Token)
	if err != nil || result.Status != appstate.Reset {
		t.Fatalf("reset = %#v, %v", result, err)
	}
	if _, err := service.ResetRecentViewState(
		context.Background(), confirmation.Token,
	); !errors.Is(err, ErrLibraryCapability) {
		t.Fatalf("reused token error = %v", err)
	}
	snapshot, err := state.Snapshot(context.Background())
	if err != nil || len(snapshot.Recent) != 0 || len(snapshot.Views) != 0 {
		t.Fatalf("snapshot = %#v, %v", snapshot, err)
	}
}
