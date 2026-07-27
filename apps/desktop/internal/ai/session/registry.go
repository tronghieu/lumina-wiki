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
	mu            sync.Mutex
	randomMu      sync.Mutex
	random        io.Reader
	onCloseError  func(error)
	current       map[WindowID]*sessionState
	windowVersion map[WindowID]uint64
	issued        map[SessionID]struct{}
	reserved      map[SessionID]struct{}
	prepared      map[*stagedActivationState]struct{}
	generation    Generation
	closed        bool
}

type sessionState struct {
	capability  Capability
	runtime     Runtime
	rootLease   TrustedRootLease
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
		random:        random,
		onCloseError:  options.OnCloseError,
		current:       make(map[WindowID]*sessionState),
		windowVersion: make(map[WindowID]uint64),
		issued:        make(map[SessionID]struct{}),
		reserved:      make(map[SessionID]struct{}),
		prepared:      make(map[*stagedActivationState]struct{}),
	}
}

func (registry *Registry) Activate(window WindowID, workspace workspaceid.WorkspaceID, display DisplayMetadata, runtime Runtime) (Capability, error) {
	return registry.ActivateDescriptor(SessionDescriptor{
		WindowID:    window,
		WorkspaceID: workspace,
		Display:     display,
		AccessMode:  AccessReadOnly,
		Runtime:     runtime,
	})
}

func (registry *Registry) ActivateDescriptor(descriptor SessionDescriptor) (Capability, error) {
	runtime := descriptor.Runtime
	if !validRuntime(runtime) {
		return Capability{}, ErrInvalidInput
	}
	if descriptor.WindowID == 0 || !descriptor.WorkspaceID.Valid() || !validDisplay(descriptor.Display) ||
		!descriptor.AccessMode.Valid() || (descriptor.RootLease != nil && !validRootLease(descriptor.RootLease)) ||
		(descriptor.AccessMode == AccessWritable && !validRootLease(descriptor.RootLease)) {
		registry.rollbackResources(runtime, descriptor.RootLease)
		return Capability{}, ErrInvalidInput
	}

	for attempt := 0; attempt < maxIDAttempts; attempt++ {
		id, err := registry.newSessionID()
		if err != nil {
			registry.rollbackResources(runtime, descriptor.RootLease)
			return Capability{}, ErrSessionEntropy
		}

		registry.mu.Lock()
		if registry.closed {
			registry.mu.Unlock()
			registry.rollbackResources(runtime, descriptor.RootLease)
			return Capability{}, ErrRegistryClosed
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
			return Capability{}, ErrInvalidInput
		}

		registry.generation++
		capability := Capability{
			SessionID:   id,
			WorkspaceID: descriptor.WorkspaceID,
			Generation:  registry.generation,
			Display:     descriptor.Display,
			AccessMode:  descriptor.AccessMode,
		}
		next := &sessionState{
			capability: capability,
			runtime:    runtime,
			rootLease:  descriptor.RootLease,
			requests:   make(map[string]*requestState),
		}
		old := registry.current[descriptor.WindowID]
		registry.current[descriptor.WindowID] = next
		registry.advanceWindowLocked(descriptor.WindowID)
		registry.issued[id] = struct{}{}
		action := registry.retireLocked(old)
		registry.mu.Unlock()

		registry.runCleanup(action)
		return capability, nil
	}

	registry.rollbackResources(runtime, descriptor.RootLease)
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

func (lease *RuntimeLease) AccessMode() AccessMode {
	if lease == nil || lease.session == nil {
		return ""
	}
	return lease.session.capability.AccessMode
}

func (lease *RuntimeLease) WorkspaceID() workspaceid.WorkspaceID {
	if lease == nil || lease.session == nil {
		return ""
	}
	return lease.session.capability.WorkspaceID
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

func (registry *Registry) advanceWindowLocked(window WindowID) {
	if registry.windowVersion[window] != ^uint64(0) {
		registry.windowVersion[window]++
	}
}

func (registry *Registry) cleanupWindowVersionLocked(window WindowID) {
	if registry.current[window] != nil {
		return
	}
	for prepared := range registry.prepared {
		if prepared.window == window {
			return
		}
	}
	delete(registry.windowVersion, window)
}
