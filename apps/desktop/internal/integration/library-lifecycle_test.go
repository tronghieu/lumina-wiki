package integration_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/history"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appstate"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/contract"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

const lifecycleWindow session.WindowID = 41

type lifecycleWindowResolver struct{}

func (lifecycleWindowResolver) ResolveWindow(context.Context) (session.WindowID, error) {
	return lifecycleWindow, nil
}

type lifecycleNativeAuthority struct {
	mu              sync.Mutex
	selection       ai.DirectorySelection
	attachPrompts   int
	createApprovals int
}

func (authority *lifecycleNativeAuthority) ChooseDirectory(
	context.Context,
	session.WindowID,
) (ai.DirectorySelection, error) {
	authority.mu.Lock()
	defer authority.mu.Unlock()
	return authority.selection, nil
}

func (*lifecycleNativeAuthority) ConfirmDirectory(context.Context, session.WindowID, string) (bool, error) {
	return true, nil
}

func (authority *lifecycleNativeAuthority) ConfirmAttachDecision(
	context.Context,
	session.WindowID,
	workspaceid.AttachKind,
) (bool, error) {
	authority.mu.Lock()
	defer authority.mu.Unlock()
	authority.attachPrompts++
	return true, nil
}

func (*lifecycleNativeAuthority) ConfirmEmbeddingDisclosure(
	context.Context,
	session.WindowID,
	ai.EmbeddingDisclosure,
) (bool, error) {
	return false, nil
}

func (authority *lifecycleNativeAuthority) ConfirmCreateDestination(
	context.Context,
	session.WindowID,
	string,
) (bool, error) {
	authority.mu.Lock()
	defer authority.mu.Unlock()
	authority.createApprovals++
	return true, nil
}

func (*lifecycleNativeAuthority) ConfirmUseEmptyDirectory(
	context.Context,
	session.WindowID,
	string,
) (bool, error) {
	return true, nil
}

func (*lifecycleNativeAuthority) ConfirmResetRecentActivity(
	context.Context,
	session.WindowID,
) (bool, error) {
	return true, nil
}

func (authority *lifecycleNativeAuthority) selectDirectory(path string) {
	authority.mu.Lock()
	defer authority.mu.Unlock()
	authority.selection = ai.DirectorySelection{Path: path, Approved: true}
}

func (authority *lifecycleNativeAuthority) promptCount() int {
	authority.mu.Lock()
	defer authority.mu.Unlock()
	return authority.attachPrompts
}

type unavailableCredentials struct{}

func (unavailableCredentials) Get(context.Context, string) ([]byte, error) {
	return nil, errors.New("credentials unavailable in lifecycle test")
}
func (unavailableCredentials) Status(context.Context, string) (secrets.CredentialStatus, error) {
	return secrets.StatusMissing, nil
}
func (unavailableCredentials) Save(context.Context, string, []byte) (secrets.SaveResult, error) {
	return secrets.SaveResult{}, errors.New("credentials unavailable in lifecycle test")
}
func (unavailableCredentials) ConfirmSessionCredential(context.Context, string, []byte) error {
	return errors.New("credentials unavailable in lifecycle test")
}
func (unavailableCredentials) Delete(context.Context, string) error { return nil }

type discardSink struct{}

func (discardSink) OnEvent(context.Context, chat.Event) error { return nil }

type discardSinkFactory struct{}

func (discardSinkFactory) NewChatSink(
	context.Context,
	session.WindowID,
	ai.SessionReferenceDTO,
) (chat.EventSink, error) {
	return discardSink{}, nil
}

type lifecycleHarness struct {
	service   *ai.Service
	manager   *workspaceid.Manager
	authority *lifecycleNativeAuthority
}

func newLifecycleHarness(t *testing.T, configBase, libraryParent string) *lifecycleHarness {
	t.Helper()
	bundle, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	provisioner, err := workspace.NewProvisioner(bundle, configBase, workspace.ProvisionOptions{})
	if err != nil {
		t.Fatal(err)
	}
	manager, err := workspaceid.NewManager(configBase, workspaceid.Options{})
	if err != nil {
		t.Fatal(err)
	}
	configStore, err := settings.NewConfigStore(configBase)
	if err != nil {
		t.Fatal(err)
	}
	state, err := appstate.NewStore(configBase)
	if err != nil {
		t.Fatal(err)
	}
	validator, err := ai.NewWorkspaceValidatorAdapter(workspace.NewService())
	if err != nil {
		t.Fatal(err)
	}
	credentials := unavailableCredentials{}
	consent := ai.NewConsentAccessGate()
	runtimes, err := ai.NewLoadedRuntimeFactory(ai.LoadedRuntimeDependencies{
		ConsentAccess: consent,
		Trust:         manager,
		Config:        configStore,
		Credentials:   credentials,
		HistoryBase:   configBase,
	})
	if err != nil {
		t.Fatal(err)
	}
	authority := &lifecycleNativeAuthority{}
	service, err := ai.NewService(ai.Dependencies{
		ConsentAccess: consent,
		Windows:       lifecycleWindowResolver{},
		Native:        authority,
		Validator:     validator,
		Attacher:      manager,
		Runtimes:      runtimes,
		Sessions:      session.NewRegistry(session.Options{}),
		Streams:       discardSinkFactory{},
		Settings:      configStore,
		Credentials:   credentials,
		LibraryState:  state,
		Library: &ai.LibraryProvisioningDependencies{
			Provisioner: provisioner,
			DefaultParent: func() (string, error) {
				return libraryParent, nil
			},
		},
	})
	if err != nil {
		_ = manager.Close()
		t.Fatal(err)
	}
	return &lifecycleHarness{service: service, manager: manager, authority: authority}
}

func (harness *lifecycleHarness) close(t *testing.T) {
	t.Helper()
	if err := harness.service.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
	if err := harness.manager.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestComposedLibraryLifecycleWithoutExternalRuntimes(t *testing.T) {
	emptyPath := t.TempDir()
	t.Setenv("PATH", emptyPath)
	for _, command := range []string{"node", "npm", "python", "python3", "lumina", "lumina-wiki"} {
		if resolved, err := exec.LookPath(command); err == nil {
			t.Fatalf("external runtime unexpectedly resolved: %s", filepath.Base(resolved))
		}
	}

	configBase := t.TempDir()
	libraryParent := t.TempDir()
	ctx := context.Background()
	name := "Nghiên cứu 资料"
	root := filepath.Join(libraryParent, name)

	first := newLifecycleHarness(t, configBase, libraryParent)
	location, err := first.service.BeginCreateLibrary(ctx, name)
	if err != nil || location.Status != ai.LocationApproved {
		t.Fatalf("create location status=%q err=%v", location.Status, err)
	}
	prepared, err := first.service.PrepareCreateLibrary(ctx, location)
	if err != nil || prepared.Status != ai.PreparationReady {
		t.Fatalf("prepare status=%q err=%v", prepared.Status, err)
	}
	created, err := first.service.CommitPreparedLibrary(ctx, prepared.PreparationToken)
	if err != nil || created.Capability == nil || created.Status != ai.CommitCreatedAndActive {
		t.Fatalf("create commit status=%q err=%v", created.Status, err)
	}
	workspaceID := created.Capability.WorkspaceID
	reference := ai.SessionReferenceDTO{
		SessionID: created.Capability.SessionID, Generation: created.Capability.Generation,
	}
	noteLocator := ai.ArtifactLocatorV1DTO{
		Version:      ai.ArtifactLocatorVersion,
		Kind:         ai.ArtifactKindWikiNote,
		RelativePath: "wiki/concepts/lifecycle-continuity.md",
	}
	noteContent := "---\nid: lifecycle-continuity\ntitle: Lifecycle Continuity\ntype: concept\n---\n\nRestored from a real user note.\n"
	if err := os.WriteFile(
		filepath.Join(root, filepath.FromSlash(noteLocator.RelativePath)),
		[]byte(noteContent),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if status, err := first.service.SetHistoryEnabled(ctx, ai.SetHistoryEnabledRequestDTO{
		Session: reference, Enabled: true,
	}); err != nil || !status.Enabled {
		t.Fatalf("enable history status=%#v err=%v", status, err)
	}
	historyStore, err := history.NewHistoryStore(configBase, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	historyAt := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	record := history.ConversationRecord{
		SchemaVersion:   history.CurrentSchemaVersion,
		ConversationID:  "lifecycle-conversation",
		AttemptID:       "attempt-1",
		CreatedAt:       historyAt,
		FinishedAt:      historyAt.Add(time.Second),
		Status:          history.StatusCompleted,
		UserMessage:     "What persisted?",
		AssistantOutput: "The real note and history persisted.",
	}
	if outcome, err := historyStore.Append(ctx, record); err != nil || outcome != history.AppendStored {
		t.Fatalf("append history outcome=%q err=%v", outcome, err)
	}
	if _, err := first.service.SaveWorkspaceView(ctx, ai.SaveWorkspaceViewRequestDTO{
		Session: reference, Focus: ai.WorkspaceFocusNote, Artifact: &noteLocator,
	}); err != nil {
		t.Fatal(err)
	}
	first.close(t)

	second := newLifecycleHarness(t, configBase, libraryParent)
	restored, err := second.service.PrepareRestoreRecentLibrary(
		ctx, ai.RestoreRecentLibraryRequestDTO{WorkspaceID: workspaceID},
	)
	if err != nil || restored.Prepared.Status != ai.PreparationReady ||
		restored.Focus != ai.WorkspaceFocusNote ||
		restored.ArtifactStatus != ai.ContinuityLoaded ||
		restored.Artifact == nil || restored.Artifact.Content != noteContent ||
		restored.Artifact.Artifact != noteLocator ||
		restored.HistoryStatus != history.LatestLoaded ||
		restored.ConversationID != record.ConversationID {
		t.Fatalf("restore status=%q focus=%q artifact=%q err=%v",
			restored.Prepared.Status, restored.Focus, restored.ArtifactStatus, err)
	}
	if second.authority.promptCount() == 0 {
		t.Fatal("process reconstruction skipped identity confirmation")
	}
	reopened, err := second.service.CommitPreparedLibrary(ctx, restored.Prepared.PreparationToken)
	if err != nil || reopened.Capability == nil || reopened.Capability.WorkspaceID != workspaceID {
		t.Fatalf("restore commit status=%q err=%v", reopened.Status, err)
	}
	latest, err := second.service.LoadLatestHistory(ctx, ai.SessionReferenceDTO{
		SessionID: reopened.Capability.SessionID, Generation: reopened.Capability.Generation,
	})
	if err != nil || latest.Status != history.LatestLoaded ||
		latest.ConversationID != record.ConversationID || len(latest.Records) != 1 ||
		latest.Records[0].AttemptID != record.AttemptID ||
		latest.Records[0].AssistantOutput != record.AssistantOutput {
		t.Fatalf("latest history status=%q conversation=%q records=%d err=%v",
			latest.Status, latest.ConversationID, len(latest.Records), err)
	}
	second.close(t)

	before := snapshotWorkspace(t, root)
	opener := newLifecycleHarness(t, configBase, libraryParent)
	opener.authority.selectDirectory(root)
	openPrepared, err := opener.service.PrepareChooseWorkspace(ctx)
	if err != nil || openPrepared.Status != ai.PreparationReady {
		t.Fatalf("open prepare status=%q err=%v", openPrepared.Status, err)
	}
	if _, err := opener.service.CommitPreparedLibrary(ctx, openPrepared.PreparationToken); err != nil {
		t.Fatal(err)
	}
	after := snapshotWorkspace(t, root)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("opening an existing library changed its names, types, modes, or bytes")
	}
	opener.close(t)

	third := newLifecycleHarness(t, configBase, libraryParent)
	movedAside := filepath.Join(libraryParent, "preserved-library")
	if err := os.Rename(root, movedAside); err != nil {
		t.Fatal(err)
	}
	if _, err := third.service.PrepareRestoreRecentLibrary(
		ctx, ai.RestoreRecentLibraryRequestDTO{WorkspaceID: workspaceID},
	); !errors.Is(err, ai.ErrLibraryUnavailable) {
		t.Fatalf("missing recent error=%v", err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := third.service.PrepareRestoreRecentLibrary(
		ctx, ai.RestoreRecentLibraryRequestDTO{WorkspaceID: workspaceID},
	); !errors.Is(err, ai.ErrLibraryUnavailable) {
		t.Fatalf("replaced recent error=%v", err)
	}
	assertNoRawRendererSurface(t)
	third.close(t)
}

type workspaceEntry struct {
	name string
	mode fs.FileMode
	size int64
	hash [sha256.Size]byte
}

func snapshotWorkspace(t *testing.T, root string) []workspaceEntry {
	t.Helper()
	var entries []workspaceEntry
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		item := workspaceEntry{name: filepath.ToSlash(relative), mode: info.Mode(), size: info.Size()}
		if info.Mode().IsRegular() {
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			item.hash = sha256.Sum256(content)
		}
		entries = append(entries, item)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].name < entries[right].name })
	return entries
}

func assertNoRawRendererSurface(t *testing.T) {
	t.Helper()
	service := reflect.TypeOf(&ai.Service{})
	for _, method := range []string{
		"ChooseAndActivateWorkspace",
		"ConfirmAndActivateWorkspace",
		"Check",
		"Import",
	} {
		if _, exists := service.MethodByName(method); exists {
			t.Fatalf("raw renderer method is exported: %s", method)
		}
	}
}
