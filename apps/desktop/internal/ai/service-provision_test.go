package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/contract"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
)

type libraryNativeAuthorityStub struct {
	*nativeAuthorityStub
	createApproved bool
	createErr      error
	emptyApproved  bool
	emptyErr       error
	destinations   []string
	emptyTargets   []string
}

func (stub *libraryNativeAuthorityStub) ConfirmCreateDestination(
	_ context.Context,
	_ session.WindowID,
	destination string,
) (bool, error) {
	stub.log.add("confirm-create")
	stub.destinations = append(stub.destinations, destination)
	return stub.createApproved, stub.createErr
}

func (stub *libraryNativeAuthorityStub) ConfirmUseEmptyDirectory(
	_ context.Context,
	_ session.WindowID,
	destination string,
) (bool, error) {
	stub.log.add("confirm-empty")
	stub.emptyTargets = append(stub.emptyTargets, destination)
	return stub.emptyApproved, stub.emptyErr
}

type provisionerStub struct {
	classification workspace.TargetClassification
	classifyErr    error
	pending        workspace.PendingLibraryOperation
	pendingExists  bool
	pendingErr     error
	removeErr      error
	classified     []string
	provisioned    []string
	removed        []string
}

func (stub *provisionerStub) Classify(_ context.Context, target string) (workspace.TargetClassification, error) {
	stub.classified = append(stub.classified, target)
	return stub.classification, stub.classifyErr
}

func (stub *provisionerStub) Provision(_ context.Context, target string) (workspace.ProvisionResult, error) {
	stub.provisioned = append(stub.provisioned, target)
	return workspace.ProvisionResult{}, errors.New("unexpected provision")
}

func (*provisionerStub) RetryPending(context.Context, string) (workspace.ProvisionResult, error) {
	return workspace.ProvisionResult{}, errors.New("unexpected retry")
}

func (stub *provisionerStub) PendingOperation(context.Context) (workspace.PendingLibraryOperation, bool, error) {
	return stub.pending, stub.pendingExists, stub.pendingErr
}

func (stub *provisionerStub) RemovePending(_ context.Context, recoveryID string) error {
	stub.removed = append(stub.removed, recoveryID)
	return stub.removeErr
}

func configureCreateLibraryService(
	t *testing.T,
	now func() time.Time,
	random io.Reader,
) (*Service, *libraryNativeAuthorityStub, *provisionerStub, string) {
	t.Helper()
	log := &callLog{}
	service, baseAuthority, _, _, _, _ := newTestService(log)
	authority := &libraryNativeAuthorityStub{
		nativeAuthorityStub: baseAuthority,
		createApproved:      true,
		emptyApproved:       true,
	}
	service.native = authority
	manager, err := workspaceid.NewManager(t.TempDir(), workspaceid.Options{})
	if err != nil {
		t.Fatal(err)
	}
	registry := session.NewRegistry(session.Options{})
	t.Cleanup(func() {
		_ = registry.Close()
		_ = manager.Close()
	})
	service.validator = &trustedValidatorStub{validatorStub{log: log, result: WorkspaceShape{Valid: true}}}
	service.attacher = manager
	service.runtimes = &trustedRuntimeFactoryStub{runtimeFactoryStub{log: log, runtime: &runtimeSpy{}}}
	service.sessions = registry
	provisioner := &provisionerStub{
		classification: workspace.TargetClassification{State: workspace.TargetAbsent},
	}
	parent := t.TempDir()
	if err := service.configureLibraryProvisioning(LibraryProvisioningDependencies{
		Provisioner:   provisioner,
		DefaultParent: func() (string, error) { return parent, nil },
		Random:        random,
		Now:           now,
		TTL:           time.Minute,
	}); err != nil {
		t.Fatal(err)
	}
	return service, authority, provisioner, parent
}

func TestCreateLocationCapabilityIsOpaquePathlessAndOneUse(t *testing.T) {
	now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	service, authority, provisioner, parent := configureCreateLibraryService(
		t,
		func() time.Time { return now },
		strings.NewReader(strings.Repeat("a", 32)+strings.Repeat("b", 96)),
	)

	location, err := service.BeginCreateLibrary(context.Background(), "Research")
	if err != nil {
		t.Fatal(err)
	}
	if location.Status != LocationApproved || location.Token == "" {
		t.Fatalf("location = %#v", location)
	}
	raw, err := json.Marshal(location)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), parent) || strings.Contains(string(raw), "Research") {
		t.Fatalf("location leaked destination: %s", raw)
	}
	if len(authority.destinations) != 1 || !strings.HasSuffix(authority.destinations[0], "Research") {
		t.Fatalf("native destinations = %v", authority.destinations)
	}

	prepared, err := service.PrepareCreateLibrary(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Status != PreparationReady || prepared.PreparationToken == "" {
		t.Fatalf("prepared = %#v", prepared)
	}
	if prepared.Snapshot.AccessMode != session.AccessWritable ||
		prepared.Snapshot.NoteAvailable ||
		len(prepared.Snapshot.Graph.Nodes) != 0 ||
		len(prepared.Snapshot.Tree.Nodes) != 0 {
		t.Fatalf("zero-node snapshot = %#v", prepared.Snapshot)
	}
	raw, err = json.Marshal(prepared)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), parent) {
		t.Fatalf("prepared snapshot leaked root: %s", raw)
	}
	if len(provisioner.classified) != 1 {
		t.Fatalf("classifications = %v", provisioner.classified)
	}
	if _, err := service.PrepareCreateLibrary(context.Background(), location); !errors.Is(err, ErrLibraryCapability) {
		t.Fatalf("replayed location = %v", err)
	}
}

func TestLibraryCapabilitiesFailClosedAcrossWindowGenerationAndExpiry(t *testing.T) {
	t.Run("cross window", func(t *testing.T) {
		now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
		service, _, _, _ := configureCreateLibraryService(
			t,
			func() time.Time { return now },
			strings.NewReader(strings.Repeat("b", 128)),
		)
		location, err := service.BeginCreateLibrary(context.Background(), "Cross Window")
		if err != nil {
			t.Fatal(err)
		}
		service.windows = &windowResolverStub{log: &callLog{}, window: 8}
		if _, err := service.PrepareCreateLibrary(context.Background(), location); !errors.Is(err, ErrLibraryCapability) {
			t.Fatalf("cross-window location = %v", err)
		}
	})

	t.Run("stale generation", func(t *testing.T) {
		now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
		service, _, _, _ := configureCreateLibraryService(
			t,
			func() time.Time { return now },
			strings.NewReader(strings.Repeat("c", 32)+strings.Repeat("d", 96)),
		)
		stale, err := service.BeginCreateLibrary(context.Background(), "First")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.BeginCreateLibrary(context.Background(), "Second"); err != nil {
			t.Fatal(err)
		}
		if _, err := service.PrepareCreateLibrary(context.Background(), stale); !errors.Is(err, ErrLibraryCapability) {
			t.Fatalf("stale location = %v", err)
		}
	})

	t.Run("expired", func(t *testing.T) {
		now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
		service, _, _, _ := configureCreateLibraryService(
			t,
			func() time.Time { return now },
			strings.NewReader(strings.Repeat("d", 128)),
		)
		location, err := service.BeginCreateLibrary(context.Background(), "Expired")
		if err != nil {
			t.Fatal(err)
		}
		now = now.Add(time.Minute)
		if _, err := service.PrepareCreateLibrary(context.Background(), location); !errors.Is(err, ErrLibraryCapability) {
			t.Fatalf("expired location = %v", err)
		}
	})
}

func TestLibraryNameValidationRejectsUnsafeChildrenBeforeNativeAuthority(t *testing.T) {
	now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	service, authority, _, _ := configureCreateLibraryService(
		t,
		func() time.Time { return now },
		strings.NewReader(strings.Repeat("e", 128)),
	)
	for _, name := range []string{"", ".", "..", "../escape", `folder\escape`, "CON", "trailing.", " leading"} {
		if _, err := service.BeginCreateLibrary(context.Background(), name); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("name %q = %v", name, err)
		}
	}
	if len(authority.destinations) != 0 {
		t.Fatalf("unsafe names reached native authority: %v", authority.destinations)
	}
}

func TestPreparedLibraryCapabilitiesAreWindowGenerationAndExpiryBound(t *testing.T) {
	t.Run("cross window does not consume owner capability", func(t *testing.T) {
		now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
		service, _, _, _ := configureCreateLibraryService(
			t,
			func() time.Time { return now },
			strings.NewReader(strings.Repeat("k", 32)+strings.Repeat("l", 96)),
		)
		location, err := service.BeginCreateLibrary(context.Background(), "Window Bound")
		if err != nil {
			t.Fatal(err)
		}
		prepared, err := service.PrepareCreateLibrary(context.Background(), location)
		if err != nil {
			t.Fatal(err)
		}
		service.windows = &windowResolverStub{log: &callLog{}, window: 8}
		if _, err := service.AbortPreparedLibrary(context.Background(), prepared.PreparationToken); !errors.Is(err, ErrLibraryCapability) {
			t.Fatalf("cross-window abort = %v", err)
		}
		service.windows = &windowResolverStub{log: &callLog{}, window: 7}
		if result, err := service.AbortPreparedLibrary(context.Background(), prepared.PreparationToken); err != nil || !result.Cancelled {
			t.Fatalf("owner abort = %#v, %v", result, err)
		}
	})

	t.Run("stale generation", func(t *testing.T) {
		now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
		service, _, _, _ := configureCreateLibraryService(
			t,
			func() time.Time { return now },
			strings.NewReader(
				strings.Repeat("m", 32)+
					strings.Repeat("n", 32)+
					strings.Repeat("o", 96),
			),
		)
		location, err := service.BeginCreateLibrary(context.Background(), "Prepared")
		if err != nil {
			t.Fatal(err)
		}
		prepared, err := service.PrepareCreateLibrary(context.Background(), location)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.BeginCreateLibrary(context.Background(), "New Attempt"); err != nil {
			t.Fatal(err)
		}
		if _, err := service.AbortPreparedLibrary(context.Background(), prepared.PreparationToken); !errors.Is(err, ErrLibraryCapability) {
			t.Fatalf("stale abort = %v", err)
		}
	})

	t.Run("new attempt prevents stale commit before mutation", func(t *testing.T) {
		now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
		service, _, provisioner, _ := configureCreateLibraryService(
			t,
			func() time.Time { return now },
			strings.NewReader(
				strings.Repeat("r", 32)+
					strings.Repeat("s", 32)+
					strings.Repeat("t", 96),
			),
		)
		location, err := service.BeginCreateLibrary(context.Background(), "Stale Commit")
		if err != nil {
			t.Fatal(err)
		}
		prepared, err := service.PrepareCreateLibrary(context.Background(), location)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.BeginCreateLibrary(context.Background(), "New Attempt"); err != nil {
			t.Fatal(err)
		}
		if _, err := service.CommitPreparedLibrary(
			context.Background(),
			prepared.PreparationToken,
		); !errors.Is(err, ErrLibraryCapability) {
			t.Fatalf("stale commit = %v", err)
		}
		if len(provisioner.provisioned) != 0 {
			t.Fatalf("stale commit mutated destinations: %v", provisioner.provisioned)
		}
	})

	t.Run("expired", func(t *testing.T) {
		now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
		service, _, _, _ := configureCreateLibraryService(
			t,
			func() time.Time { return now },
			strings.NewReader(strings.Repeat("p", 32)+strings.Repeat("q", 96)),
		)
		location, err := service.BeginCreateLibrary(context.Background(), "Prepared")
		if err != nil {
			t.Fatal(err)
		}
		prepared, err := service.PrepareCreateLibrary(context.Background(), location)
		if err != nil {
			t.Fatal(err)
		}
		now = now.Add(time.Minute)
		if _, err := service.AbortPreparedLibrary(context.Background(), prepared.PreparationToken); !errors.Is(err, ErrLibraryCapability) {
			t.Fatalf("expired abort = %v", err)
		}
	})
}

type realLibraryServiceFixture struct {
	service     *Service
	authority   *libraryNativeAuthorityStub
	provisioner *workspace.Provisioner
	registry    *session.Registry
	factory     *trustedRuntimeFactoryStub
	parent      string
}

type blockingLibraryProvisioner struct {
	LibraryProvisioner
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

type blockingPostCommitProvisioner struct {
	LibraryProvisioner
	removeEntered  chan struct{}
	pendingEntered chan struct{}
	removeOnce     sync.Once
	pendingOnce    sync.Once
}

func (provisioner *blockingPostCommitProvisioner) RemovePending(
	ctx context.Context,
	_ string,
) error {
	provisioner.removeOnce.Do(func() { close(provisioner.removeEntered) })
	<-ctx.Done()
	return ctx.Err()
}

func (provisioner *blockingPostCommitProvisioner) PendingOperation(
	ctx context.Context,
) (workspace.PendingLibraryOperation, bool, error) {
	provisioner.pendingOnce.Do(func() { close(provisioner.pendingEntered) })
	<-ctx.Done()
	return workspace.PendingLibraryOperation{}, false, ctx.Err()
}

func (provisioner *blockingLibraryProvisioner) Provision(
	ctx context.Context,
	target string,
) (workspace.ProvisionResult, error) {
	provisioner.once.Do(func() { close(provisioner.entered) })
	select {
	case <-provisioner.release:
	case <-ctx.Done():
		return workspace.ProvisionResult{}, ctx.Err()
	}
	return provisioner.LibraryProvisioner.Provision(ctx, target)
}

func newRealLibraryServiceFixture(t *testing.T) realLibraryServiceFixture {
	t.Helper()
	log := &callLog{}
	service, baseAuthority, _, _, _, _ := newTestService(log)
	authority := &libraryNativeAuthorityStub{
		nativeAuthorityStub: baseAuthority,
		createApproved:      true,
		emptyApproved:       true,
	}
	service.native = authority
	manager, err := workspaceid.NewManager(t.TempDir(), workspaceid.Options{})
	if err != nil {
		t.Fatal(err)
	}
	registry := session.NewRegistry(session.Options{})
	factory := &trustedRuntimeFactoryStub{runtimeFactoryStub{log: log, runtime: &runtimeSpy{}}}
	service.validator = &trustedValidatorStub{validatorStub{log: log, result: WorkspaceShape{Valid: true}}}
	service.attacher = manager
	service.runtimes = factory
	service.sessions = registry
	t.Cleanup(func() {
		_ = registry.Close()
		_ = manager.Close()
	})

	bundle, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	configBase := t.TempDir()
	provisioner, err := workspace.NewProvisioner(bundle, configBase, workspace.ProvisionOptions{
		RandomID: func() (string, error) { return strings.Repeat("1", 32), nil },
		ApproveExistingEmpty: func(ctx context.Context, destination string) error {
			approved, err := authority.ConfirmUseEmptyDirectory(ctx, 7, destination)
			if err != nil || !approved {
				return workspace.ErrEmptyNeedsApproval
			}
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	parent := t.TempDir()
	random := strings.NewReader(
		strings.Repeat("f", 32) +
			strings.Repeat("g", 32) +
			strings.Repeat("h", 32) +
			strings.Repeat("i", 32) +
			strings.Repeat("j", 32),
	)
	if err := service.configureLibraryProvisioning(LibraryProvisioningDependencies{
		Provisioner: provisioner, DefaultParent: func() (string, error) { return parent, nil },
		Random: random, Now: time.Now, TTL: time.Minute,
	}); err != nil {
		t.Fatal(err)
	}
	return realLibraryServiceFixture{
		service: service, authority: authority, provisioner: provisioner,
		registry: registry, factory: factory, parent: parent,
	}
}

func TestCommitCreatedLibraryActivatesAtomicallyAndClearsPending(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	location, err := fixture.service.BeginCreateLibrary(context.Background(), "Created")
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := fixture.service.PrepareCreateLibrary(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	result, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != CommitCreatedAndActive || result.Capability == nil ||
		result.Capability.AccessMode != session.AccessWritable || result.Snapshot == nil ||
		result.RecoveryRetained {
		t.Fatalf("commit = %#v", result)
	}
	if _, exists, err := fixture.provisioner.PendingOperation(context.Background()); err != nil || exists {
		t.Fatalf("pending exists=%v err=%v", exists, err)
	}
	snapshot, err := fixture.service.WorkspaceSnapshot(
		context.Background(),
		SessionReferenceDTO{SessionID: result.Capability.SessionID, Generation: result.Capability.Generation},
	)
	if err != nil || snapshot.AccessMode != session.AccessWritable {
		t.Fatalf("snapshot = %#v, %v", snapshot, err)
	}
	if _, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken); !errors.Is(err, ErrLibraryCapability) {
		t.Fatalf("replayed commit = %v", err)
	}
}

func TestCommitCreatedLibraryBoundsPendingCleanupAfterActivation(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	location, _ := fixture.service.BeginCreateLibrary(context.Background(), "Cleanup Contended")
	prepared, _ := fixture.service.PrepareCreateLibrary(context.Background(), location)
	blocking := &blockingPostCommitProvisioner{
		LibraryProvisioner: fixture.provisioner,
		removeEntered:      make(chan struct{}),
		pendingEntered:     make(chan struct{}),
	}
	fixture.service.libraries.provisioner = blocking

	type outcome struct {
		result ReadyCommitDTO
		err    error
	}
	completed := make(chan outcome, 1)
	go func() {
		result, err := fixture.service.CommitPreparedLibrary(
			context.Background(), prepared.PreparationToken,
		)
		completed <- outcome{result: result, err: err}
	}()
	select {
	case <-blocking.removeEntered:
	case <-time.After(5 * time.Second):
		t.Fatal("pending cleanup was not attempted")
	}
	select {
	case commit := <-completed:
		if commit.err != nil || commit.result.Capability == nil ||
			commit.result.Status != CommitCreatedAndActive || !commit.result.RecoveryRetained {
			t.Fatalf("commit = %#v, %v", commit.result, commit.err)
		}
		lease, resolveErr := fixture.registry.Resolve(7, session.Reference{
			SessionID:  commit.result.Capability.SessionID,
			Generation: commit.result.Capability.Generation,
		})
		if resolveErr != nil {
			t.Fatalf("committed session unavailable: %v", resolveErr)
		}
		lease.Finish()
	case <-time.After(time.Second):
		t.Fatal("pending cleanup blocked the committed session")
	}
}

func TestCreatedNotActiveBoundsPendingInspectionAfterPublication(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	location, _ := fixture.service.BeginCreateLibrary(context.Background(), "Pending Contended")
	prepared, _ := fixture.service.PrepareCreateLibrary(context.Background(), location)
	fixture.factory.err = errStub
	blocking := &blockingPostCommitProvisioner{
		LibraryProvisioner: fixture.provisioner,
		removeEntered:      make(chan struct{}),
		pendingEntered:     make(chan struct{}),
	}
	fixture.service.libraries.provisioner = blocking

	type outcome struct {
		result ReadyCommitDTO
		err    error
	}
	completed := make(chan outcome, 1)
	go func() {
		result, err := fixture.service.CommitPreparedLibrary(
			context.Background(), prepared.PreparationToken,
		)
		completed <- outcome{result: result, err: err}
	}()
	select {
	case <-blocking.pendingEntered:
	case <-time.After(5 * time.Second):
		t.Fatal("pending recovery inspection was not attempted")
	}
	select {
	case commit := <-completed:
		if commit.err != nil || commit.result.Status != CommitCreatedNotActive ||
			!commit.result.RecoveryRetained || commit.result.Capability != nil ||
			commit.result.Pending != nil {
			t.Fatalf("commit = %#v, %v", commit.result, commit.err)
		}
	case <-time.After(time.Second):
		t.Fatal("pending recovery inspection blocked the publication result")
	}
}

func TestBeginWaitsForClaimedCommitPersistenceAndSessionSwap(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	location, err := fixture.service.BeginCreateLibrary(context.Background(), "Committed First")
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := fixture.service.PrepareCreateLibrary(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	blocking := &blockingLibraryProvisioner{
		LibraryProvisioner: fixture.provisioner,
		entered:            make(chan struct{}),
		release:            make(chan struct{}),
	}
	fixture.service.libraries.provisioner = blocking

	commitDone := make(chan struct{})
	var commitResult ReadyCommitDTO
	var commitErr error
	go func() {
		defer close(commitDone)
		commitResult, commitErr = fixture.service.CommitPreparedLibrary(
			context.Background(),
			prepared.PreparationToken,
		)
	}()
	select {
	case <-blocking.entered:
	case <-time.After(time.Second):
		t.Fatal("commit did not claim the token and enter provisioning")
	}

	beginStarted := make(chan struct{})
	beginDone := make(chan struct{})
	var beginResult LocationCapabilityDTO
	var beginErr error
	go func() {
		close(beginStarted)
		beginResult, beginErr = fixture.service.BeginCreateLibrary(context.Background(), "Next Attempt")
		close(beginDone)
	}()
	<-beginStarted
	select {
	case <-beginDone:
		t.Fatalf("new attempt interleaved with claimed commit: %#v, %v", beginResult, beginErr)
	case <-time.After(100 * time.Millisecond):
	}

	close(blocking.release)
	select {
	case <-commitDone:
	case <-time.After(5 * time.Second):
		t.Fatal("commit did not finish")
	}
	if commitErr != nil || commitResult.Status != CommitCreatedAndActive {
		t.Fatalf("commit = %#v, %v", commitResult, commitErr)
	}
	select {
	case <-beginDone:
	case <-time.After(time.Second):
		t.Fatal("new attempt did not resume after commit")
	}
	if beginErr != nil || beginResult.Status != LocationApproved {
		t.Fatalf("new attempt = %#v, %v", beginResult, beginErr)
	}
}

func TestCreatedNotActivePreservesPriorSessionAndRecoveryCanFinish(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	priorRuntime := &runtimeSpy{}
	prior, err := fixture.registry.Activate(
		7,
		testWorkspaceID,
		session.DisplayMetadata{Label: "Prior"},
		priorRuntime,
	)
	if err != nil {
		t.Fatal(err)
	}
	location, err := fixture.service.BeginCreateLibrary(context.Background(), "Recoverable")
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := fixture.service.PrepareCreateLibrary(context.Background(), location)
	if err != nil {
		t.Fatal(err)
	}
	fixture.factory.err = errStub
	result, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != CommitCreatedNotActive || result.Capability != nil || !result.RecoveryRetained {
		t.Fatalf("failed activation result = %#v", result)
	}
	if result.Pending == nil || !result.Pending.Available || result.Pending.RecoveryID == "" {
		t.Fatalf("failed activation did not expose pending recovery: %#v", result.Pending)
	}
	lease, err := fixture.registry.Resolve(7, prior.Reference())
	if err != nil {
		t.Fatalf("prior session changed: %v", err)
	}
	lease.Finish()
	pending, err := fixture.service.ListPendingLibraryOperation(context.Background())
	if err != nil || !pending.Available || pending.RecoveryID == "" {
		t.Fatalf("pending = %#v, %v", pending, err)
	}
	if *result.Pending != pending {
		t.Fatalf("commit pending = %#v, listed pending = %#v", *result.Pending, pending)
	}

	fixture.factory.err = nil
	recovery, err := fixture.service.PreparePendingLibraryOperation(context.Background(), pending.RecoveryID)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := fixture.service.CommitPreparedLibrary(context.Background(), recovery.PreparationToken)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Status != CommitCreatedAndActive || recovered.Capability == nil || recovered.RecoveryRetained {
		t.Fatalf("recovery commit = %#v", recovered)
	}
	if _, exists, err := fixture.provisioner.PendingOperation(context.Background()); err != nil || exists {
		t.Fatalf("pending after recovery exists=%v err=%v", exists, err)
	}
}

func TestCreateReclassifiesUnderLockAndRequiresFreshEmptyApproval(t *testing.T) {
	t.Run("existing empty is confirmed only during commit", func(t *testing.T) {
		fixture := newRealLibraryServiceFixture(t)
		target := filepath.Join(fixture.parent, "Existing Empty")
		if err := os.Mkdir(target, 0o700); err != nil {
			t.Fatal(err)
		}
		location, err := fixture.service.BeginCreateLibrary(context.Background(), "Existing Empty")
		if err != nil {
			t.Fatal(err)
		}
		prepared, err := fixture.service.PrepareCreateLibrary(context.Background(), location)
		if err != nil {
			t.Fatal(err)
		}
		if len(fixture.authority.emptyTargets) != 0 {
			t.Fatal("empty approval ran before the creation lock")
		}
		result, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
		if err != nil || result.Status != CommitCreatedAndActive {
			t.Fatalf("commit = %#v, %v", result, err)
		}
		if len(fixture.authority.emptyTargets) != 1 || fixture.authority.emptyTargets[0] != target {
			t.Fatalf("empty targets = %v", fixture.authority.emptyTargets)
		}
	})

	t.Run("destination changed after prepare is a collision", func(t *testing.T) {
		fixture := newRealLibraryServiceFixture(t)
		target := filepath.Join(fixture.parent, "Raced")
		location, err := fixture.service.BeginCreateLibrary(context.Background(), "Raced")
		if err != nil {
			t.Fatal(err)
		}
		prepared, err := fixture.service.PrepareCreateLibrary(context.Background(), location)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(target, 0o700); err != nil {
			t.Fatal(err)
		}
		foreign := filepath.Join(target, "foreign.txt")
		if err := os.WriteFile(foreign, []byte("keep"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := fixture.service.CommitPreparedLibrary(
			context.Background(),
			prepared.PreparationToken,
		); !errors.Is(err, ErrLibraryCollision) {
			t.Fatalf("commit collision = %v", err)
		}
		if raw, err := os.ReadFile(foreign); err != nil || string(raw) != "keep" {
			t.Fatalf("foreign entry changed: %q %v", raw, err)
		}
		if len(fixture.authority.emptyTargets) != 0 {
			t.Fatalf("occupied target prompted as empty: %v", fixture.authority.emptyTargets)
		}
	})
}

func TestPrepareOpenIsReadOnlyPathlessAbortableAndByteIdentical(t *testing.T) {
	fixture := newRealLibraryServiceFixture(t)
	root := filepath.Join(fixture.parent, "Existing")
	provisioned, err := fixture.provisioner.Provision(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_ = provisioned.Root.Close()
	if err := fixture.provisioner.RemovePending(context.Background(), provisioned.RecoveryID); err != nil {
		t.Fatal(err)
	}
	fixture.authority.selection = DirectorySelection{Path: root, Approved: true}
	before := hashWorkspaceManifest(t, root)

	prepared, err := fixture.service.PrepareChooseWorkspace(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Status != PreparationReady || prepared.Kind != LibraryOperationOpen ||
		prepared.Snapshot.AccessMode != session.AccessReadOnly {
		t.Fatalf("prepared open = %#v", prepared)
	}
	raw, err := json.Marshal(prepared)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), root) {
		t.Fatalf("prepared open leaked root: %s", raw)
	}
	aborted, err := fixture.service.AbortPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil || !aborted.Cancelled {
		t.Fatalf("abort = %#v, %v", aborted, err)
	}
	if _, err := fixture.service.AbortPreparedLibrary(context.Background(), prepared.PreparationToken); !errors.Is(err, ErrLibraryCapability) {
		t.Fatalf("replayed abort = %v", err)
	}

	prepared, err = fixture.service.PrepareChooseWorkspace(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	result, err := fixture.service.CommitPreparedLibrary(context.Background(), prepared.PreparationToken)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != CommitOpenedAndActive || result.Capability == nil ||
		result.Capability.AccessMode != session.AccessReadOnly {
		t.Fatalf("open commit = %#v", result)
	}
	after := hashWorkspaceManifest(t, root)
	if len(before) != len(after) {
		t.Fatalf("workspace file count changed: before=%d after=%d", len(before), len(after))
	}
	for path, hash := range before {
		if after[path] != hash {
			t.Fatalf("workspace bytes changed at %s", path)
		}
	}
}
