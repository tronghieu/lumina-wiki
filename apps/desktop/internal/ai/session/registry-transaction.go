package session

type stagedActivationStatus uint8

const (
	stagedActivationPrepared stagedActivationStatus = iota
	stagedActivationCommitted
	stagedActivationAborted
)

type stagedActivationState struct {
	registry        *Registry
	window          WindowID
	expectedVersion uint64
	prior           *sessionState
	next            *sessionState
	status          stagedActivationStatus
}

// StagedActivation is a copy-safe handle to one prepared session transition.
// Copies share terminal state, so replay cannot commit or clean resources twice.
type StagedActivation struct {
	state *stagedActivationState
}

func (registry *Registry) PrepareActivation(descriptor SessionDescriptor) (StagedActivation, error) {
	runtime := descriptor.Runtime
	if !validRuntime(runtime) {
		return StagedActivation{}, ErrInvalidInput
	}
	if descriptor.WindowID == 0 || !descriptor.WorkspaceID.Valid() || !validDisplay(descriptor.Display) ||
		!descriptor.AccessMode.Valid() || !validRootLease(descriptor.RootLease) {
		registry.rollbackResources(runtime, descriptor.RootLease)
		return StagedActivation{}, ErrInvalidInput
	}

	for attempt := 0; attempt < maxIDAttempts; attempt++ {
		id, err := registry.newSessionID()
		if err != nil {
			registry.rollbackResources(runtime, descriptor.RootLease)
			return StagedActivation{}, ErrSessionEntropy
		}

		registry.mu.Lock()
		if registry.closed {
			registry.mu.Unlock()
			registry.rollbackResources(runtime, descriptor.RootLease)
			return StagedActivation{}, ErrRegistryClosed
		}
		if _, exists := registry.issued[id]; exists {
			registry.mu.Unlock()
			continue
		}
		if _, exists := registry.reserved[id]; exists {
			registry.mu.Unlock()
			continue
		}
		if registry.generation == ^Generation(0) || registry.windowVersion[descriptor.WindowID] == ^uint64(0) {
			registry.mu.Unlock()
			registry.rollbackResources(runtime, descriptor.RootLease)
			return StagedActivation{}, ErrInvalidInput
		}

		capability := Capability{
			SessionID:   id,
			WorkspaceID: descriptor.WorkspaceID,
			Display:     descriptor.Display,
			AccessMode:  descriptor.AccessMode,
		}
		next := &sessionState{
			capability: capability,
			runtime:    runtime,
			rootLease:  descriptor.RootLease,
			requests:   make(map[string]*requestState),
		}
		state := &stagedActivationState{
			registry:        registry,
			window:          descriptor.WindowID,
			expectedVersion: registry.windowVersion[descriptor.WindowID],
			prior:           registry.current[descriptor.WindowID],
			next:            next,
			status:          stagedActivationPrepared,
		}
		registry.reserved[id] = struct{}{}
		registry.prepared[state] = struct{}{}
		registry.mu.Unlock()
		return StagedActivation{state: state}, nil
	}

	registry.rollbackResources(runtime, descriptor.RootLease)
	return StagedActivation{}, ErrSessionEntropy
}

// Commit performs the guarded in-memory swap without an external persistence
// step. Cleanup failure is reported through OnCloseError and cannot roll back
// a committed capability.
func (staged StagedActivation) Commit() (Capability, error) {
	return staged.CommitWith(func() error { return nil })
}

// CommitWith holds the registry critical section while it revalidates the
// prepared transition, invokes persist, and performs the infallible in-memory
// swap. persist must not call back into this Registry. A stale transition never
// invokes persist; a persistence error aborts the staged resources and leaves
// the prior session current.
func (staged StagedActivation) CommitWith(persist func() error) (Capability, error) {
	if staged.state == nil || staged.state.registry == nil {
		return Capability{}, ErrStagedActivation
	}
	if persist == nil {
		return Capability{}, ErrInvalidInput
	}
	state, registry := staged.state, staged.state.registry
	registry.mu.Lock()
	if state.status != stagedActivationPrepared {
		registry.mu.Unlock()
		return Capability{}, ErrStagedActivation
	}
	_, tracked := registry.prepared[state]
	if registry.closed ||
		!tracked ||
		registry.windowVersion[state.window] != state.expectedVersion ||
		registry.current[state.window] != state.prior ||
		registry.generation == ^Generation(0) {
		action := registry.abortPreparedLocked(state)
		registry.mu.Unlock()
		registry.runCleanup(action)
		return Capability{}, ErrStagedActivation
	}
	if err := persist(); err != nil {
		action := registry.abortPreparedLocked(state)
		registry.mu.Unlock()
		registry.runCleanup(action)
		return Capability{}, err
	}

	state.status = stagedActivationCommitted
	delete(registry.prepared, state)
	delete(registry.reserved, state.next.capability.SessionID)
	registry.generation++
	state.next.capability.Generation = registry.generation
	registry.current[state.window] = state.next
	registry.advanceWindowLocked(state.window)
	registry.cleanupWindowVersionLocked(state.window)
	action := registry.retireLocked(state.prior)
	capability := state.next.capability
	registry.mu.Unlock()

	registry.runCleanup(action)
	return capability, nil
}

func (staged StagedActivation) Abort() error {
	if staged.state == nil || staged.state.registry == nil {
		return ErrStagedActivation
	}
	state, registry := staged.state, staged.state.registry
	registry.mu.Lock()
	if state.status != stagedActivationPrepared {
		registry.mu.Unlock()
		return ErrStagedActivation
	}
	action := registry.abortPreparedLocked(state)
	registry.mu.Unlock()
	if registry.runCleanup(action) {
		return ErrRuntimeClose
	}
	return nil
}

func (registry *Registry) abortPreparedLocked(state *stagedActivationState) cleanupAction {
	if state == nil || state.status != stagedActivationPrepared {
		return cleanupAction{}
	}
	state.status = stagedActivationAborted
	delete(registry.prepared, state)
	delete(registry.reserved, state.next.capability.SessionID)
	registry.cleanupWindowVersionLocked(state.window)
	return cleanupAction{runtime: state.next.runtime, rootLease: state.next.rootLease}
}
