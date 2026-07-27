package session

import (
	"context"
	"sync"
)

type cleanupAction struct {
	cancels   []context.CancelFunc
	runtime   Runtime
	rootLease TrustedRootLease
}

func (registry *Registry) Deactivate(window WindowID, reference Reference) error {
	finish, err := registry.BeginDeactivate(window, reference)
	if err != nil {
		return err
	}
	return finish()
}

// BeginDeactivate authenticates and retires a session before returning its
// cleanup step. Callers may commit related lifecycle state before cleanup
// invokes runtime code.
func (registry *Registry) BeginDeactivate(window WindowID, reference Reference) (func() error, error) {
	if window == 0 || !validSessionID(reference.SessionID) || reference.Generation == 0 {
		return nil, ErrInvalidSession
	}
	registry.mu.Lock()
	session, ok := registry.resolveLocked(window, reference)
	if !ok {
		registry.mu.Unlock()
		return nil, ErrInvalidSession
	}
	delete(registry.current, window)
	registry.advanceWindowLocked(window)
	registry.cleanupWindowVersionLocked(window)
	action := registry.retireLocked(session)
	registry.mu.Unlock()
	var once sync.Once
	var cleanupErr error
	return func() error {
		once.Do(func() {
			if registry.runCleanup(action) {
				cleanupErr = ErrRuntimeClose
			}
		})
		return cleanupErr
	}, nil
}

func (registry *Registry) CloseWindow(window WindowID) error {
	if window == 0 {
		return ErrInvalidInput
	}
	registry.mu.Lock()
	session := registry.current[window]
	delete(registry.current, window)
	registry.advanceWindowLocked(window)
	actions := make([]cleanupAction, 0, 1)
	for prepared := range registry.prepared {
		if prepared.window == window {
			actions = append(actions, registry.abortPreparedLocked(prepared))
		}
	}
	registry.cleanupWindowVersionLocked(window)
	actions = append(actions, registry.retireLocked(session))
	registry.mu.Unlock()
	failed := false
	for _, action := range actions {
		failed = registry.runCleanup(action) || failed
	}
	if failed {
		return ErrRuntimeClose
	}
	return nil
}

func (registry *Registry) Close() error {
	registry.mu.Lock()
	if registry.closed {
		registry.mu.Unlock()
		return nil
	}
	registry.closed = true
	actions := make([]cleanupAction, 0, len(registry.current)+len(registry.prepared))
	for prepared := range registry.prepared {
		actions = append(actions, registry.abortPreparedLocked(prepared))
	}
	for window, session := range registry.current {
		delete(registry.current, window)
		registry.cleanupWindowVersionLocked(window)
		actions = append(actions, registry.retireLocked(session))
	}
	clear(registry.windowVersion)
	registry.mu.Unlock()

	failed := false
	for _, action := range actions {
		failed = registry.runCleanup(action) || failed
	}
	if failed {
		return ErrRuntimeClose
	}
	return nil
}

func (registry *Registry) retireLocked(session *sessionState) cleanupAction {
	if session == nil || session.retired {
		return cleanupAction{}
	}
	session.retired = true
	action := cleanupAction{cancels: make([]context.CancelFunc, 0, len(session.requests))}
	for _, request := range session.requests {
		action.cancels = append(action.cancels, request.cancel)
	}
	closeAction := registry.closeIfUnusedLocked(session)
	action.runtime = closeAction.runtime
	action.rootLease = closeAction.rootLease
	return action
}

func (registry *Registry) closeIfUnusedLocked(session *sessionState) cleanupAction {
	if session == nil || !session.retired || session.refs != 0 || session.closeQueued {
		return cleanupAction{}
	}
	session.closeQueued = true
	return cleanupAction{runtime: session.runtime, rootLease: session.rootLease}
}

func (registry *Registry) release(session *sessionState) {
	registry.mu.Lock()
	if session.refs > 0 {
		session.refs--
	}
	action := registry.closeIfUnusedLocked(session)
	registry.mu.Unlock()
	registry.runCleanup(action)
}

func (registry *Registry) runCleanup(action cleanupAction) bool {
	for _, cancel := range action.cancels {
		cancel()
	}
	failed := false
	if action.runtime != nil {
		if err := action.runtime.Close(); err != nil {
			if registry.onCloseError != nil {
				registry.onCloseError(ErrRuntimeClose)
			}
			failed = true
		}
	}
	if action.rootLease != nil {
		if err := action.rootLease.Close(); err != nil {
			if registry.onCloseError != nil {
				registry.onCloseError(ErrRootLeaseClose)
			}
			failed = true
		}
	}
	return failed
}

func (registry *Registry) rollbackResources(runtime Runtime, rootLease TrustedRootLease) {
	action := cleanupAction{}
	if validRuntime(runtime) {
		action.runtime = runtime
	}
	if validRootLease(rootLease) {
		action.rootLease = rootLease
	}
	if action.runtime != nil || action.rootLease != nil {
		registry.runCleanup(action)
	}
}

func (registry *Registry) rollbackRuntime(runtime Runtime) {
	if validRuntime(runtime) {
		registry.runCleanup(cleanupAction{runtime: runtime})
	}
}
