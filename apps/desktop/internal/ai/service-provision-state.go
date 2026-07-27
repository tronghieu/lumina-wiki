package ai

import (
	"crypto/rand"
	"encoding/base64"
	"io"
	"sync"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

const (
	defaultLibraryCapabilityTTL = 5 * time.Minute
	maxLibraryCapabilityTTL     = 30 * time.Minute
	libraryTokenBytes           = 32
	libraryTokenAttempts        = 8
	maxLibraryIssuedTokens      = 16384
)

type libraryLocation struct {
	token      string
	window     session.WindowID
	generation uint64
	expiresAt  time.Time
	name       string
	target     string
	parent     rootproof.RootProof
}

type preparedLibrary struct {
	token      string
	window     session.WindowID
	generation uint64
	expiresAt  time.Time
	kind       LibraryOperationKind
	name       string
	target     string
	recoveryID string
	snapshot   WorkspaceSnapshotDTO
	parent     rootproof.RootProof
	root       rootproof.RootProof
	attach     *workspaceid.PreparedAttach
	staged     session.StagedActivation
	stagedSet  bool
	runtime    session.Runtime
}

type activeLibrarySnapshot struct {
	reference session.Reference
	snapshot  WorkspaceSnapshotDTO
}

type libraryAttemptLease struct {
	gate *sync.Mutex
}

func (lease *libraryAttemptLease) Finish() {
	if lease == nil || lease.gate == nil {
		return
	}
	lease.gate.Unlock()
	lease.gate = nil
}

type libraryCoordinator struct {
	mu sync.Mutex

	provisioner   LibraryProvisioner
	defaultParent func() (string, error)
	random        io.Reader
	now           func() time.Time
	ttl           time.Duration
	closed        bool
	generation    map[session.WindowID]uint64
	attemptGates  map[session.WindowID]*sync.Mutex
	locations     map[string]*libraryLocation
	prepared      map[string]*preparedLibrary
	issued        map[string]struct{}
	active        map[session.WindowID]activeLibrarySnapshot
}

func (service *Service) configureLibraryProvisioning(dependencies LibraryProvisioningDependencies) error {
	if service == nil || nilLike(dependencies.Provisioner) || dependencies.DefaultParent == nil {
		return ErrInvalidInput
	}
	if _, ok := service.native.(LibraryNativeAuthority); !ok {
		return ErrInvalidInput
	}
	if _, ok := service.validator.(TrustedWorkspaceValidator); !ok {
		return ErrInvalidInput
	}
	if _, ok := service.attacher.(PreparedWorkspaceAttacher); !ok {
		return ErrInvalidInput
	}
	if _, ok := service.runtimes.(TrustedRuntimeFactory); !ok {
		return ErrInvalidInput
	}
	if _, ok := service.sessions.(StagedSessionRegistry); !ok {
		return ErrInvalidInput
	}
	if dependencies.Random == nil {
		dependencies.Random = rand.Reader
	}
	if dependencies.Now == nil {
		dependencies.Now = time.Now
	}
	if dependencies.TTL == 0 {
		dependencies.TTL = defaultLibraryCapabilityTTL
	}
	if dependencies.TTL < time.Second || dependencies.TTL > maxLibraryCapabilityTTL {
		return ErrInvalidInput
	}
	service.libraries = &libraryCoordinator{
		provisioner: dependencies.Provisioner, defaultParent: dependencies.DefaultParent,
		random: dependencies.Random, now: dependencies.Now, ttl: dependencies.TTL,
		generation:   make(map[session.WindowID]uint64),
		attemptGates: make(map[session.WindowID]*sync.Mutex),
		locations:    make(map[string]*libraryLocation),
		prepared:     make(map[string]*preparedLibrary),
		issued:       make(map[string]struct{}),
		active:       make(map[session.WindowID]activeLibrarySnapshot),
	}
	return nil
}

func (coordinator *libraryCoordinator) attemptGate(window session.WindowID) *sync.Mutex {
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	gate := coordinator.attemptGates[window]
	if gate == nil {
		gate = &sync.Mutex{}
		coordinator.attemptGates[window] = gate
	}
	return gate
}

func (coordinator *libraryCoordinator) nextTokenLocked() (string, error) {
	if len(coordinator.issued) >= maxLibraryIssuedTokens {
		return "", ErrLibraryUnavailable
	}
	for range libraryTokenAttempts {
		raw := make([]byte, libraryTokenBytes)
		if _, err := io.ReadFull(coordinator.random, raw); err != nil {
			return "", ErrLibraryUnavailable
		}
		token := base64.RawURLEncoding.EncodeToString(raw)
		clear(raw)
		if _, exists := coordinator.issued[token]; exists {
			continue
		}
		coordinator.issued[token] = struct{}{}
		return token, nil
	}
	return "", ErrLibraryUnavailable
}

func (coordinator *libraryCoordinator) beginAttempt(window session.WindowID) (uint64, error) {
	if coordinator == nil || window == 0 {
		return 0, ErrLibraryUnavailable
	}
	gate := coordinator.attemptGate(window)
	gate.Lock()
	defer gate.Unlock()
	coordinator.mu.Lock()
	if coordinator.closed || coordinator.generation[window] == ^uint64(0) {
		coordinator.mu.Unlock()
		return 0, ErrLibraryUnavailable
	}
	coordinator.generation[window]++
	generation := coordinator.generation[window]
	locations, prepared := coordinator.removeWindowPendingLocked(window)
	coordinator.mu.Unlock()
	cleanupLocations(locations)
	cleanupPreparedLibraries(prepared)
	return generation, nil
}

func (coordinator *libraryCoordinator) removeWindowPendingLocked(
	window session.WindowID,
) ([]*libraryLocation, []*preparedLibrary) {
	var locations []*libraryLocation
	for token, location := range coordinator.locations {
		if location.window == window {
			delete(coordinator.locations, token)
			locations = append(locations, location)
		}
	}
	var prepared []*preparedLibrary
	for token, candidate := range coordinator.prepared {
		if candidate.window == window {
			delete(coordinator.prepared, token)
			prepared = append(prepared, candidate)
		}
	}
	return locations, prepared
}

func (coordinator *libraryCoordinator) addLocation(location *libraryLocation) error {
	if coordinator == nil || location == nil {
		return ErrLibraryCapability
	}
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	if coordinator.closed || coordinator.generation[location.window] != location.generation {
		return ErrLibraryCapability
	}
	token, err := coordinator.nextTokenLocked()
	if err != nil {
		return err
	}
	location.token = token
	location.expiresAt = coordinator.now().Add(coordinator.ttl)
	coordinator.locations[token] = location
	return nil
}

func (coordinator *libraryCoordinator) takeLocation(
	window session.WindowID,
	capability LocationCapabilityDTO,
) (*libraryLocation, error) {
	if coordinator == nil || capability.Status != LocationApproved || capability.Token == "" {
		return nil, ErrLibraryCapability
	}
	coordinator.mu.Lock()
	location, ok := coordinator.locations[capability.Token]
	if !ok || location.window != window {
		coordinator.mu.Unlock()
		return nil, ErrLibraryCapability
	}
	delete(coordinator.locations, capability.Token)
	valid := !coordinator.closed &&
		coordinator.generation[window] == location.generation &&
		coordinator.now().Before(location.expiresAt)
	coordinator.mu.Unlock()
	if !valid {
		cleanupLocation(location)
		return nil, ErrLibraryCapability
	}
	return location, nil
}

func (coordinator *libraryCoordinator) addPrepared(candidate *preparedLibrary) error {
	if coordinator == nil || candidate == nil {
		return ErrLibraryCapability
	}
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	if coordinator.closed || coordinator.generation[candidate.window] != candidate.generation {
		return ErrLibraryCapability
	}
	token, err := coordinator.nextTokenLocked()
	if err != nil {
		return err
	}
	candidate.token = token
	candidate.expiresAt = coordinator.now().Add(coordinator.ttl)
	coordinator.prepared[token] = candidate
	return nil
}

func (coordinator *libraryCoordinator) takePrepared(
	window session.WindowID,
	token string,
) (*preparedLibrary, error) {
	if coordinator == nil || token == "" {
		return nil, ErrLibraryCapability
	}
	coordinator.mu.Lock()
	candidate, ok := coordinator.prepared[token]
	if !ok || candidate.window != window {
		coordinator.mu.Unlock()
		return nil, ErrLibraryCapability
	}
	delete(coordinator.prepared, token)
	valid := !coordinator.closed &&
		coordinator.generation[window] == candidate.generation &&
		coordinator.now().Before(candidate.expiresAt)
	coordinator.mu.Unlock()
	if !valid {
		cleanupPreparedLibrary(candidate)
		return nil, ErrLibraryCapability
	}
	return candidate, nil
}

// claimPreparedForCommit linearizes a commit with attempt generation for its
// window. Callers must hold the returned lease through persistence and session
// swap. The coordinator mutex is never held while the session registry is used.
func (coordinator *libraryCoordinator) claimPreparedForCommit(
	window session.WindowID,
	token string,
) (*preparedLibrary, *libraryAttemptLease, error) {
	if coordinator == nil || window == 0 {
		return nil, nil, ErrLibraryCapability
	}
	gate := coordinator.attemptGate(window)
	gate.Lock()
	lease := &libraryAttemptLease{gate: gate}
	candidate, err := coordinator.takePrepared(window, token)
	if err != nil {
		lease.Finish()
		return nil, nil, err
	}
	return candidate, lease, nil
}

func (coordinator *libraryCoordinator) abortPrepared(window session.WindowID, token string) error {
	candidate, err := coordinator.takePrepared(window, token)
	if err != nil {
		return err
	}
	cleanupPreparedLibrary(candidate)
	return nil
}

func (coordinator *libraryCoordinator) setActive(
	window session.WindowID,
	reference session.Reference,
	snapshot WorkspaceSnapshotDTO,
) {
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	if !coordinator.closed {
		coordinator.active[window] = activeLibrarySnapshot{
			reference: reference,
			snapshot:  cloneWorkspaceSnapshot(snapshot),
		}
	}
}

func (coordinator *libraryCoordinator) activeSnapshot(
	window session.WindowID,
	reference session.Reference,
) (WorkspaceSnapshotDTO, bool) {
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	active, ok := coordinator.active[window]
	if !ok || active.reference != reference {
		return WorkspaceSnapshotDTO{}, false
	}
	return cloneWorkspaceSnapshot(active.snapshot), true
}

func (coordinator *libraryCoordinator) removeActive(
	window session.WindowID,
	reference session.Reference,
) {
	if coordinator == nil {
		return
	}
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	active, ok := coordinator.active[window]
	if ok && active.reference == reference {
		delete(coordinator.active, window)
	}
}

func (coordinator *libraryCoordinator) closeWindow(window session.WindowID) {
	if coordinator == nil || window == 0 {
		return
	}
	gate := coordinator.attemptGate(window)
	gate.Lock()
	defer gate.Unlock()
	coordinator.mu.Lock()
	if coordinator.generation[window] != ^uint64(0) {
		coordinator.generation[window]++
	}
	locations, prepared := coordinator.removeWindowPendingLocked(window)
	delete(coordinator.active, window)
	coordinator.mu.Unlock()
	cleanupLocations(locations)
	cleanupPreparedLibraries(prepared)
}

func (coordinator *libraryCoordinator) close() {
	if coordinator == nil {
		return
	}
	coordinator.mu.Lock()
	if coordinator.closed {
		coordinator.mu.Unlock()
		return
	}
	coordinator.closed = true
	var locations []*libraryLocation
	for token, location := range coordinator.locations {
		delete(coordinator.locations, token)
		locations = append(locations, location)
	}
	var prepared []*preparedLibrary
	for token, candidate := range coordinator.prepared {
		delete(coordinator.prepared, token)
		prepared = append(prepared, candidate)
	}
	clear(coordinator.active)
	coordinator.mu.Unlock()
	cleanupLocations(locations)
	cleanupPreparedLibraries(prepared)
}

func cleanupLocation(location *libraryLocation) {
	if location != nil {
		_ = location.parent.Close()
	}
}

func cleanupLocations(locations []*libraryLocation) {
	for _, location := range locations {
		cleanupLocation(location)
	}
}

func cleanupPreparedLibrary(candidate *preparedLibrary) {
	if candidate == nil {
		return
	}
	if candidate.stagedSet {
		_ = candidate.staged.Abort()
		candidate.stagedSet = false
	}
	candidate.runtime = nil
	if candidate.attach != nil {
		_ = candidate.attach.Abort()
		candidate.attach = nil
	}
	_ = candidate.root.Close()
	_ = candidate.parent.Close()
}

func cleanupPreparedLibraries(candidates []*preparedLibrary) {
	for _, candidate := range candidates {
		cleanupPreparedLibrary(candidate)
	}
}
