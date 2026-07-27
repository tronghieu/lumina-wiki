package session

import (
	"context"
	"sync"
)

type requestState struct {
	cancel context.CancelFunc
}

type RequestLease struct {
	once      sync.Once
	registry  *Registry
	session   *sessionState
	requestID string
	request   *requestState
}

func (registry *Registry) BeginRequest(parent context.Context, window WindowID, reference Reference, requestID string) (context.Context, *RequestLease, error) {
	if parent == nil || window == 0 || !validSessionID(reference.SessionID) || reference.Generation == 0 || !requestIDPattern.MatchString(requestID) {
		return nil, nil, ErrInvalidInput
	}

	registry.mu.Lock()
	session, ok := registry.resolveLocked(window, reference)
	if !ok {
		registry.mu.Unlock()
		return nil, nil, ErrInvalidSession
	}
	if _, exists := session.requests[requestID]; exists {
		registry.mu.Unlock()
		return nil, nil, ErrRequestActive
	}
	requestContext, cancel := context.WithCancel(parent)
	request := &requestState{cancel: cancel}
	session.requests[requestID] = request
	session.refs++
	registry.mu.Unlock()

	lease := &RequestLease{registry: registry, session: session, requestID: requestID, request: request}
	return requestContext, lease, nil
}

func (registry *Registry) CancelRequest(window WindowID, reference Reference, requestID string) error {
	if window == 0 || !validSessionID(reference.SessionID) || reference.Generation == 0 {
		return ErrInvalidSession
	}
	registry.mu.Lock()
	session, ok := registry.resolveLocked(window, reference)
	if !ok {
		registry.mu.Unlock()
		return ErrInvalidSession
	}
	if !requestIDPattern.MatchString(requestID) {
		registry.mu.Unlock()
		return ErrInvalidInput
	}
	request := session.requests[requestID]
	registry.mu.Unlock()
	if request != nil {
		request.cancel()
	}
	return nil
}

func (lease *RequestLease) Runtime() Runtime {
	if lease == nil || lease.session == nil {
		return nil
	}
	return lease.session.runtime
}

func (lease *RequestLease) Finish() {
	if lease == nil {
		return
	}
	lease.once.Do(func() {
		registry := lease.registry
		registry.mu.Lock()
		if lease.session.requests[lease.requestID] == lease.request {
			delete(lease.session.requests, lease.requestID)
		}
		if lease.session.refs > 0 {
			lease.session.refs--
		}
		action := registry.closeIfUnusedLocked(lease.session)
		registry.mu.Unlock()

		lease.request.cancel()
		registry.runCleanup(action)
	})
}
