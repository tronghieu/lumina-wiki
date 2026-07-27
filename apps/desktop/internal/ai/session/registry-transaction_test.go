package session

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"
)

func writableDescriptor(window WindowID, runtime Runtime) SessionDescriptor {
	return SessionDescriptor{
		WindowID:    window,
		WorkspaceID: testWorkspaceID,
		Display:     DisplayMetadata{Label: "Created library"},
		AccessMode:  AccessWritable,
		Runtime:     runtime,
		RootLease:   &trustedRootLeaseSpy{},
	}
}

func TestPrepareActivationKeepsPriorSessionUntilCommit(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	oldRuntime, stagedRuntime := &runtimeSpy{}, &runtimeSpy{}
	old := activate(t, registry, 1, oldRuntime)
	requestContext, request, err := registry.BeginRequest(context.Background(), 1, old.Reference(), "active")
	if err != nil {
		t.Fatal(err)
	}

	staged, err := registry.PrepareActivation(writableDescriptor(1, stagedRuntime))
	if err != nil {
		t.Fatal(err)
	}
	oldLease, err := registry.Resolve(1, old.Reference())
	if err != nil {
		t.Fatalf("prepare replaced prior session: %v", err)
	}
	oldLease.Finish()
	if requestContext.Err() != nil || oldRuntime.closeCount() != 0 || stagedRuntime.closeCount() != 0 {
		t.Fatalf("prepare changed lifecycle: request=%v old=%d staged=%d", requestContext.Err(), oldRuntime.closeCount(), stagedRuntime.closeCount())
	}

	capability, err := staged.Commit()
	if err != nil {
		t.Fatal(err)
	}
	if capability.AccessMode != AccessWritable || capability.WorkspaceID != testWorkspaceID {
		t.Fatalf("capability=%+v", capability)
	}
	if requestContext.Err() != context.Canceled {
		t.Fatalf("prior request was not cancelled at commit: %v", requestContext.Err())
	}
	if _, err := registry.Resolve(1, old.Reference()); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("prior session remained current: %v", err)
	}
	lease, err := registry.Resolve(1, capability.Reference())
	if err != nil || lease.AccessMode() != AccessWritable {
		t.Fatalf("staged session was not committed: lease=%#v err=%v", lease, err)
	}
	lease.Finish()
	if oldRuntime.closeCount() != 0 {
		t.Fatal("commit closed prior runtime while its request lease remained")
	}
	request.Finish()
	if oldRuntime.closeCount() != 1 || stagedRuntime.closeCount() != 0 {
		t.Fatalf("old closes=%d staged closes=%d", oldRuntime.closeCount(), stagedRuntime.closeCount())
	}
}

func TestAbortLeavesPriorSessionAndRequestsUntouched(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	oldRuntime, stagedRuntime := &runtimeSpy{}, &runtimeSpy{}
	old := activate(t, registry, 1, oldRuntime)
	requestContext, request, err := registry.BeginRequest(context.Background(), 1, old.Reference(), "active")
	if err != nil {
		t.Fatal(err)
	}
	staged, err := registry.PrepareActivation(writableDescriptor(1, stagedRuntime))
	if err != nil {
		t.Fatal(err)
	}

	if err := staged.Abort(); err != nil {
		t.Fatal(err)
	}
	if requestContext.Err() != nil || oldRuntime.closeCount() != 0 || stagedRuntime.closeCount() != 1 {
		t.Fatalf("abort changed prior session: request=%v old=%d staged=%d", requestContext.Err(), oldRuntime.closeCount(), stagedRuntime.closeCount())
	}
	lease, err := registry.Resolve(1, old.Reference())
	if err != nil {
		t.Fatalf("prior session unavailable after abort: %v", err)
	}
	lease.Finish()
	if err := staged.Abort(); !errors.Is(err, ErrStagedActivation) {
		t.Fatalf("double abort=%v", err)
	}
	if _, err := staged.Commit(); !errors.Is(err, ErrStagedActivation) {
		t.Fatalf("commit after abort=%v", err)
	}
	request.Finish()
}

func TestStagedActivationFailsClosedWhenWindowStateChanges(t *testing.T) {
	t.Run("same window replacement", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1, 2, 3)})
		_ = activate(t, registry, 1, &runtimeSpy{})
		stagedRuntime := &runtimeSpy{}
		staged, err := registry.PrepareActivation(writableDescriptor(1, stagedRuntime))
		if err != nil {
			t.Fatal(err)
		}
		replacement := activate(t, registry, 1, &runtimeSpy{})
		if _, err := staged.Commit(); !errors.Is(err, ErrStagedActivation) {
			t.Fatalf("stale commit=%v", err)
		}
		if stagedRuntime.closeCount() != 1 {
			t.Fatalf("stale runtime closes=%d", stagedRuntime.closeCount())
		}
		lease, err := registry.Resolve(1, replacement.Reference())
		if err != nil {
			t.Fatalf("replacement leaked: %v", err)
		}
		lease.Finish()
	})

	t.Run("closed empty window", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1)})
		stagedRuntime := &runtimeSpy{}
		staged, err := registry.PrepareActivation(writableDescriptor(9, stagedRuntime))
		if err != nil {
			t.Fatal(err)
		}
		if err := registry.CloseWindow(9); err != nil {
			t.Fatal(err)
		}
		if _, err := staged.Commit(); !errors.Is(err, ErrStagedActivation) {
			t.Fatalf("closed-window commit=%v", err)
		}
		if stagedRuntime.closeCount() != 1 {
			t.Fatalf("closed-window runtime closes=%d", stagedRuntime.closeCount())
		}
	})

	t.Run("competing preparations", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1, 2)})
		firstRuntime, secondRuntime := &runtimeSpy{}, &runtimeSpy{}
		first, err := registry.PrepareActivation(writableDescriptor(4, firstRuntime))
		if err != nil {
			t.Fatal(err)
		}
		second, err := registry.PrepareActivation(writableDescriptor(4, secondRuntime))
		if err != nil {
			t.Fatal(err)
		}
		capability, err := first.Commit()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := second.Commit(); !errors.Is(err, ErrStagedActivation) {
			t.Fatalf("competing commit=%v", err)
		}
		if firstRuntime.closeCount() != 0 || secondRuntime.closeCount() != 1 {
			t.Fatalf("first closes=%d second closes=%d", firstRuntime.closeCount(), secondRuntime.closeCount())
		}
		lease, err := registry.Resolve(4, capability.Reference())
		if err != nil {
			t.Fatalf("winning session unavailable: %v", err)
		}
		lease.Finish()
	})

	t.Run("registry shutdown", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1)})
		stagedRuntime := &runtimeSpy{}
		staged, err := registry.PrepareActivation(writableDescriptor(5, stagedRuntime))
		if err != nil {
			t.Fatal(err)
		}
		if err := registry.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err := staged.Commit(); !errors.Is(err, ErrStagedActivation) {
			t.Fatalf("shutdown commit=%v", err)
		}
		if stagedRuntime.closeCount() != 1 {
			t.Fatalf("shutdown runtime closes=%d", stagedRuntime.closeCount())
		}
	})
}

func TestStagedActivationReplayAndCrossWindowIsolation(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	firstRuntime, stagedRuntime := &runtimeSpy{}, &runtimeSpy{}
	first := activate(t, registry, 1, firstRuntime)
	requestContext, request, err := registry.BeginRequest(context.Background(), 1, first.Reference(), "active")
	if err != nil {
		t.Fatal(err)
	}
	staged, err := registry.PrepareActivation(writableDescriptor(2, stagedRuntime))
	if err != nil {
		t.Fatal(err)
	}
	replayed := staged
	second, err := staged.Commit()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := replayed.Commit(); !errors.Is(err, ErrStagedActivation) {
		t.Fatalf("replayed commit=%v", err)
	}
	if err := replayed.Abort(); !errors.Is(err, ErrStagedActivation) {
		t.Fatalf("abort after commit=%v", err)
	}
	if requestContext.Err() != nil || firstRuntime.closeCount() != 0 || stagedRuntime.closeCount() != 0 {
		t.Fatalf("cross-window leak: request=%v first=%d staged=%d", requestContext.Err(), firstRuntime.closeCount(), stagedRuntime.closeCount())
	}
	for window, reference := range map[WindowID]Reference{1: first.Reference(), 2: second.Reference()} {
		lease, err := registry.Resolve(window, reference)
		if err != nil {
			t.Fatalf("window %d resolve=%v", window, err)
		}
		lease.Finish()
	}
	request.Finish()
}

func TestPrepareActivationFailurePreservesPriorSession(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1)})
	old := activate(t, registry, 1, &runtimeSpy{})
	incoming := &runtimeSpy{}
	descriptor := writableDescriptor(1, incoming)
	descriptor.AccessMode = ""
	if _, err := registry.PrepareActivation(descriptor); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid descriptor=%v", err)
	}
	if incoming.closeCount() != 1 {
		t.Fatalf("invalid runtime closes=%d", incoming.closeCount())
	}
	lease, err := registry.Resolve(1, old.Reference())
	if err != nil {
		t.Fatalf("invalid prepare replaced prior session: %v", err)
	}
	lease.Finish()

	failing := NewRegistry(Options{Random: bytes.NewReader(nil)})
	failingRuntime := &runtimeSpy{}
	if _, err := failing.PrepareActivation(writableDescriptor(1, failingRuntime)); !errors.Is(err, ErrSessionEntropy) {
		t.Fatalf("entropy failure=%v", err)
	}
	if failingRuntime.closeCount() != 1 {
		t.Fatalf("entropy runtime closes=%d", failingRuntime.closeCount())
	}
}

func TestAbortCleanupFailureDoesNotChangePriorSession(t *testing.T) {
	closeErrors := make(chan error, 1)
	registry := NewRegistry(Options{Random: entropy(1, 2), OnCloseError: func(err error) { closeErrors <- err }})
	old := activate(t, registry, 1, &runtimeSpy{})
	stagedRuntime := &runtimeSpy{err: errors.New("raw close error")}
	staged, err := registry.PrepareActivation(writableDescriptor(1, stagedRuntime))
	if err != nil {
		t.Fatal(err)
	}
	if err := staged.Abort(); !errors.Is(err, ErrRuntimeClose) {
		t.Fatalf("abort cleanup=%v", err)
	}
	if err := <-closeErrors; !errors.Is(err, ErrRuntimeClose) {
		t.Fatalf("close warning=%v", err)
	}
	lease, err := registry.Resolve(1, old.Reference())
	if err != nil {
		t.Fatalf("prior session unavailable: %v", err)
	}
	lease.Finish()
}

func TestCommitIgnoresPostSwapCleanupFailure(t *testing.T) {
	closeErrors := make(chan error, 1)
	registry := NewRegistry(Options{Random: entropy(1, 2), OnCloseError: func(err error) { closeErrors <- err }})
	oldRuntime := &runtimeSpy{err: errors.New("raw close error")}
	_ = activate(t, registry, 1, oldRuntime)
	stagedRuntime := &runtimeSpy{}
	staged, err := registry.PrepareActivation(writableDescriptor(1, stagedRuntime))
	if err != nil {
		t.Fatal(err)
	}
	capability, err := staged.Commit()
	if err != nil {
		t.Fatalf("post-commit cleanup became commit failure: %v", err)
	}
	lease, err := registry.Resolve(1, capability.Reference())
	if err != nil {
		t.Fatalf("committed session unavailable: %v", err)
	}
	lease.Finish()
	if err := <-closeErrors; !errors.Is(err, ErrRuntimeClose) {
		t.Fatalf("close warning=%v", err)
	}
}

func TestConcurrentCommitAbortHasOneTerminalOutcome(t *testing.T) {
	for run := 0; run < 50; run++ {
		registry := NewRegistry(Options{})
		runtime := &runtimeSpy{}
		staged, err := registry.PrepareActivation(writableDescriptor(1, runtime))
		if err != nil {
			t.Fatal(err)
		}
		var wait sync.WaitGroup
		wait.Add(2)
		commitResult := make(chan error, 1)
		abortResult := make(chan error, 1)
		go func() {
			defer wait.Done()
			_, err := staged.Commit()
			commitResult <- err
		}()
		go func() {
			defer wait.Done()
			abortResult <- staged.Abort()
		}()
		wait.Wait()
		commitErr, abortErr := <-commitResult, <-abortResult
		if (commitErr == nil) == (abortErr == nil) {
			t.Fatalf("run=%d commit=%v abort=%v", run, commitErr, abortErr)
		}
		loser := commitErr
		if loser == nil {
			loser = abortErr
		}
		if !errors.Is(loser, ErrStagedActivation) {
			t.Fatalf("run=%d loser=%v", run, loser)
		}
		if abortErr == nil && runtime.closeCount() != 1 {
			t.Fatalf("run=%d aborted runtime closes=%d", run, runtime.closeCount())
		}
		if commitErr == nil && runtime.closeCount() != 0 {
			t.Fatalf("run=%d committed runtime closes=%d", run, runtime.closeCount())
		}
	}
}

func TestStagedActivationOwnsTrustedRootLease(t *testing.T) {
	t.Run("abort", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1)})
		runtime, rootLease := &runtimeSpy{}, &trustedRootLeaseSpy{}
		descriptor := writableDescriptor(1, runtime)
		descriptor.RootLease = rootLease
		staged, err := registry.PrepareActivation(descriptor)
		if err != nil {
			t.Fatal(err)
		}
		if err := staged.Abort(); err != nil {
			t.Fatal(err)
		}
		if runtime.closeCount() != 1 || rootLease.closeCount() != 1 {
			t.Fatalf("runtime closes=%d root closes=%d", runtime.closeCount(), rootLease.closeCount())
		}
	})

	t.Run("stale commit", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1, 2)})
		runtime, rootLease := &runtimeSpy{}, &trustedRootLeaseSpy{}
		descriptor := writableDescriptor(1, runtime)
		descriptor.RootLease = rootLease
		staged, err := registry.PrepareActivation(descriptor)
		if err != nil {
			t.Fatal(err)
		}
		_ = activate(t, registry, 1, &runtimeSpy{})
		if _, err := staged.Commit(); !errors.Is(err, ErrStagedActivation) {
			t.Fatalf("commit=%v", err)
		}
		if runtime.closeCount() != 1 || rootLease.closeCount() != 1 {
			t.Fatalf("runtime closes=%d root closes=%d", runtime.closeCount(), rootLease.closeCount())
		}
	})

	t.Run("window close", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1)})
		runtime, rootLease := &runtimeSpy{}, &trustedRootLeaseSpy{}
		descriptor := writableDescriptor(7, runtime)
		descriptor.RootLease = rootLease
		staged, err := registry.PrepareActivation(descriptor)
		if err != nil {
			t.Fatal(err)
		}
		if err := registry.CloseWindow(7); err != nil {
			t.Fatal(err)
		}
		if runtime.closeCount() != 1 || rootLease.closeCount() != 1 {
			t.Fatalf("runtime closes=%d root closes=%d", runtime.closeCount(), rootLease.closeCount())
		}
		if _, err := staged.Commit(); !errors.Is(err, ErrStagedActivation) {
			t.Fatalf("commit after close=%v", err)
		}
		if runtime.closeCount() != 1 || rootLease.closeCount() != 1 {
			t.Fatal("closed staged resources more than once")
		}
	})

	t.Run("registry close", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1)})
		runtime, rootLease := &runtimeSpy{}, &trustedRootLeaseSpy{}
		descriptor := writableDescriptor(3, runtime)
		descriptor.RootLease = rootLease
		staged, err := registry.PrepareActivation(descriptor)
		if err != nil {
			t.Fatal(err)
		}
		if err := registry.Close(); err != nil {
			t.Fatal(err)
		}
		if runtime.closeCount() != 1 || rootLease.closeCount() != 1 {
			t.Fatalf("runtime closes=%d root closes=%d", runtime.closeCount(), rootLease.closeCount())
		}
		if err := staged.Abort(); !errors.Is(err, ErrStagedActivation) {
			t.Fatalf("abort after close=%v", err)
		}
	})

	t.Run("commit transfers ownership", func(t *testing.T) {
		registry := NewRegistry(Options{Random: entropy(1)})
		runtime, rootLease := &runtimeSpy{}, &trustedRootLeaseSpy{}
		descriptor := writableDescriptor(1, runtime)
		descriptor.RootLease = rootLease
		staged, err := registry.PrepareActivation(descriptor)
		if err != nil {
			t.Fatal(err)
		}
		capability, err := staged.Commit()
		if err != nil {
			t.Fatal(err)
		}
		if runtime.closeCount() != 0 || rootLease.closeCount() != 0 {
			t.Fatal("commit closed transferred resources")
		}
		if err := registry.Deactivate(1, capability.Reference()); err != nil {
			t.Fatal(err)
		}
		if runtime.closeCount() != 1 || rootLease.closeCount() != 1 {
			t.Fatalf("runtime closes=%d root closes=%d", runtime.closeCount(), rootLease.closeCount())
		}
	})
}

func TestAbortedPreparationsDoNotRetainRegistryState(t *testing.T) {
	const attempts = 10_000
	registry := NewRegistry(Options{Random: bytes.NewReader(make([]byte, attempts*sessionBytes))})
	for attempt := 0; attempt < attempts; attempt++ {
		staged, err := registry.PrepareActivation(writableDescriptor(1, &runtimeSpy{}))
		if err != nil {
			t.Fatalf("prepare %d: %v", attempt, err)
		}
		if err := staged.Abort(); err != nil {
			t.Fatalf("abort %d: %v", attempt, err)
		}
	}
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if registry.generation != 0 || len(registry.issued) != 0 || len(registry.reserved) != 0 || len(registry.prepared) != 0 {
		t.Fatalf("generation=%d issued=%d reserved=%d prepared=%d",
			registry.generation, len(registry.issued), len(registry.reserved), len(registry.prepared))
	}
	if _, retained := registry.windowVersion[1]; retained {
		t.Fatal("aborted empty-window version retained")
	}
}

func TestCloseWindowDoesNotRetainEmptyWindowVersion(t *testing.T) {
	registry := NewRegistry(Options{})
	if err := registry.CloseWindow(99); err != nil {
		t.Fatal(err)
	}
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if _, retained := registry.windowVersion[99]; retained {
		t.Fatal("empty window version retained")
	}
}

func TestCommitWithPersistenceFailureDoesNotSwapSession(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	priorRuntime, stagedRuntime := &runtimeSpy{}, &runtimeSpy{}
	prior := activate(t, registry, 1, priorRuntime)
	staged, err := registry.PrepareActivation(writableDescriptor(1, stagedRuntime))
	if err != nil {
		t.Fatal(err)
	}
	persistErr := errors.New("identity persistence failed")
	calls := 0
	if _, err := staged.CommitWith(func() error {
		calls++
		return persistErr
	}); !errors.Is(err, persistErr) {
		t.Fatalf("commit error = %v", err)
	}
	if calls != 1 {
		t.Fatalf("persist calls = %d", calls)
	}
	lease, err := registry.Resolve(1, prior.Reference())
	if err != nil {
		t.Fatalf("prior session was replaced: %v", err)
	}
	lease.Finish()
	if priorRuntime.closeCount() != 0 || stagedRuntime.closeCount() != 1 {
		t.Fatalf("prior closes=%d staged closes=%d", priorRuntime.closeCount(), stagedRuntime.closeCount())
	}
}

func TestCommitWithNeverPersistsStaleStage(t *testing.T) {
	tests := []struct {
		name  string
		stale func(*Registry)
	}{
		{
			name: "closed window",
			stale: func(registry *Registry) {
				if err := registry.CloseWindow(1); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "registry closed",
			stale: func(registry *Registry) {
				if err := registry.Close(); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "competing activation",
			stale: func(registry *Registry) {
				_ = activate(t, registry, 1, &runtimeSpy{})
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			registry := NewRegistry(Options{Random: entropy(1, 2)})
			staged, err := registry.PrepareActivation(writableDescriptor(1, &runtimeSpy{}))
			if err != nil {
				t.Fatal(err)
			}
			test.stale(registry)
			calls := 0
			if _, err := staged.CommitWith(func() error {
				calls++
				return nil
			}); !errors.Is(err, ErrStagedActivation) {
				t.Fatalf("commit = %v", err)
			}
			if calls != 0 {
				t.Fatalf("stale persistence calls = %d", calls)
			}
		})
	}
}

func TestCommitWithCloseRacePersistsOnlyForWinningCommit(t *testing.T) {
	for run := 0; run < 100; run++ {
		registry := NewRegistry(Options{})
		staged, err := registry.PrepareActivation(writableDescriptor(1, &runtimeSpy{}))
		if err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		commitResult := make(chan error, 1)
		closeResult := make(chan error, 1)
		persistCalls := make(chan struct{}, 1)
		go func() {
			<-start
			_, err := staged.CommitWith(func() error {
				persistCalls <- struct{}{}
				return nil
			})
			commitResult <- err
		}()
		go func() {
			<-start
			closeResult <- registry.CloseWindow(1)
		}()
		close(start)
		commitErr, closeErr := <-commitResult, <-closeResult
		if closeErr != nil {
			t.Fatalf("run=%d close=%v", run, closeErr)
		}
		calls := len(persistCalls)
		if commitErr == nil && calls != 1 {
			t.Fatalf("run=%d winning commit calls=%d", run, calls)
		}
		if errors.Is(commitErr, ErrStagedActivation) && calls != 0 {
			t.Fatalf("run=%d stale commit persisted", run)
		}
		if commitErr != nil && !errors.Is(commitErr, ErrStagedActivation) {
			t.Fatalf("run=%d commit=%v", run, commitErr)
		}
	}
}

func TestCommitWithCompetingActivationRacePersistsOnlyForWinningCommit(t *testing.T) {
	for run := 0; run < 100; run++ {
		registry := NewRegistry(Options{})
		stagedRuntime := &runtimeSpy{}
		staged, err := registry.PrepareActivation(writableDescriptor(1, stagedRuntime))
		if err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		commitResult := make(chan error, 1)
		activationResult := make(chan error, 1)
		persistCalls := make(chan struct{}, 1)
		go func() {
			<-start
			_, err := staged.CommitWith(func() error {
				persistCalls <- struct{}{}
				return nil
			})
			commitResult <- err
		}()
		go func() {
			<-start
			_, err := registry.Activate(
				1,
				testWorkspaceID,
				DisplayMetadata{Label: "Replacement"},
				&runtimeSpy{},
			)
			activationResult <- err
		}()
		close(start)
		commitErr, activationErr := <-commitResult, <-activationResult
		if activationErr != nil {
			t.Fatalf("run=%d activation=%v", run, activationErr)
		}
		calls := len(persistCalls)
		if commitErr == nil && calls != 1 {
			t.Fatalf("run=%d winning commit calls=%d", run, calls)
		}
		if errors.Is(commitErr, ErrStagedActivation) && calls != 0 {
			t.Fatalf("run=%d stale commit persisted", run)
		}
		if commitErr != nil && !errors.Is(commitErr, ErrStagedActivation) {
			t.Fatalf("run=%d commit=%v", run, commitErr)
		}
		if stagedRuntime.closeCount() != 1 {
			t.Fatalf("run=%d staged runtime closes=%d", run, stagedRuntime.closeCount())
		}
	}
}
