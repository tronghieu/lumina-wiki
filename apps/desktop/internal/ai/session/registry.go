package session

import (
	"crypto/rand"
	"encoding/base64"
	"io"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

type Options struct {
	Random       io.Reader
	OnCloseError func(error)
}

type Registry struct {
	mu           sync.Mutex
	randomMu     sync.Mutex
	random       io.Reader
	onCloseError func(error)
	current      map[WindowID]*sessionState
	issued       map[SessionID]struct{}
	generation   Generation
	closed       bool
}

type sessionState struct {
	capability  Capability
	runtime     Runtime
	requests    map[string]*requestState
	refs        uint64
	retired     bool
	closeQueued bool
}

type RuntimeLease struct {
	once     sync.Once
	registry *Registry
	session  *sessionState
}

func NewRegistry(options Options) *Registry {
	random := options.Random
	if random == nil {
		random = rand.Reader
	}
	return &Registry{
		random:       random,
		onCloseError: options.OnCloseError,
		current:      make(map[WindowID]*sessionState),
		issued:       make(map[SessionID]struct{}),
	}
}

func (registry *Registry) Activate(window WindowID, workspace workspaceid.WorkspaceID, display DisplayMetadata, runtime Runtime) (Capability, error) {
	if !validRuntime(runtime) {
		return Capability{}, ErrInvalidInput
	}
	if window == 0 || !workspace.Valid() || !validDisplay(display) {
		registry.rollbackRuntime(runtime)
		return Capability{}, ErrInvalidInput
	}

	for attempt := 0; attempt < maxIDAttempts; attempt++ {
		id, err := registry.newSessionID()
		if err != nil {
			registry.rollbackRuntime(runtime)
			return Capability{}, ErrSessionEntropy
		}

		registry.mu.Lock()
		if registry.closed {
			registry.mu.Unlock()
			registry.rollbackRuntime(runtime)
			return Capability{}, ErrRegistryClosed
		}
		if _, exists := registry.issued[id]; exists {
			registry.mu.Unlock()
			continue
		}
		if registry.generation == ^Generation(0) {
			registry.mu.Unlock()
			registry.rollbackRuntime(runtime)
			return Capability{}, ErrInvalidInput
		}

		registry.generation++
		capability := Capability{id, workspace, registry.generation, display}
		next := &sessionState{capability: capability, runtime: runtime, requests: make(map[string]*requestState)}
		old := registry.current[window]
		registry.current[window] = next
		registry.issued[id] = struct{}{}
		action := registry.retireLocked(old)
		registry.mu.Unlock()

		registry.runCleanup(action)
		return capability, nil
	}

	registry.rollbackRuntime(runtime)
	return Capability{}, ErrSessionEntropy
}

func (registry *Registry) Resolve(window WindowID, reference Reference) (*RuntimeLease, error) {
	if window == 0 || !validSessionID(reference.SessionID) || reference.Generation == 0 {
		return nil, ErrInvalidSession
	}
	registry.mu.Lock()
	session, ok := registry.resolveLocked(window, reference)
	if !ok {
		registry.mu.Unlock()
		return nil, ErrInvalidSession
	}
	session.refs++
	registry.mu.Unlock()
	return &RuntimeLease{registry: registry, session: session}, nil
}

func (lease *RuntimeLease) Runtime() Runtime {
	if lease == nil || lease.session == nil {
		return nil
	}
	return lease.session.runtime
}

func (lease *RuntimeLease) Finish() {
	if lease == nil {
		return
	}
	lease.once.Do(func() { lease.registry.release(lease.session) })
}

func (registry *Registry) newSessionID() (SessionID, error) {
	raw := make([]byte, sessionBytes)
	registry.randomMu.Lock()
	_, err := io.ReadFull(registry.random, raw)
	registry.randomMu.Unlock()
	if err != nil {
		return "", err
	}
	return SessionID(sessionPrefix + base64.RawURLEncoding.EncodeToString(raw)), nil
}

func (registry *Registry) resolveLocked(window WindowID, reference Reference) (*sessionState, bool) {
	session := registry.current[window]
	return session, session != nil && !session.retired && session.capability.Reference() == reference
}
