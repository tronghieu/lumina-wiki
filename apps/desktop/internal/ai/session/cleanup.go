package session

import "context"

type cleanupAction struct {
	cancels []context.CancelFunc
	runtime Runtime
}

func (registry *Registry) Deactivate(window WindowID, reference Reference) error {
	if window == 0 || !validSessionID(reference.SessionID) || reference.Generation == 0 {
		return ErrInvalidSession
	}
	registry.mu.Lock()
	session, ok := registry.resolveLocked(window, reference)
	if !ok {
		registry.mu.Unlock()
		return ErrInvalidSession
	}
	delete(registry.current, window)
	action := registry.retireLocked(session)
	registry.mu.Unlock()
	if registry.runCleanup(action) {
		return ErrRuntimeClose
	}
	return nil
}

func (registry *Registry) CloseWindow(window WindowID) error {
	if window == 0 {
		return ErrInvalidInput
	}
	registry.mu.Lock()
	session := registry.current[window]
	delete(registry.current, window)
	action := registry.retireLocked(session)
	registry.mu.Unlock()
	if registry.runCleanup(action) {
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
	actions := make([]cleanupAction, 0, len(registry.current))
	for window, session := range registry.current {
		delete(registry.current, window)
		actions = append(actions, registry.retireLocked(session))
	}
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
	return action
}

func (registry *Registry) closeIfUnusedLocked(session *sessionState) cleanupAction {
	if session == nil || !session.retired || session.refs != 0 || session.closeQueued {
		return cleanupAction{}
	}
	session.closeQueued = true
	return cleanupAction{runtime: session.runtime}
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
	if action.runtime == nil {
		return false
	}
	if err := action.runtime.Close(); err != nil {
		if registry.onCloseError != nil {
			registry.onCloseError(ErrRuntimeClose)
		}
		return true
	}
	return false
}

func (registry *Registry) rollbackRuntime(runtime Runtime) {
	if validRuntime(runtime) {
		registry.runCleanup(cleanupAction{runtime: runtime})
	}
}
