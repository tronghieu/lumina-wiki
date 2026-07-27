package workspaceid

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"sync"
	"time"
)

type Options struct {
	Clock           func() time.Time
	Random          func([]byte) error
	Canonicalizer   Canonicalizer
	SignatureProbe  SignatureProbe
	OpenDirectory   OpenDirectory
	HandleSignature HandleSignature
	IDSource        func() (WorkspaceID, error)
	Hash            func([]byte) (string, error)
	DecisionTTL     time.Duration
	MaxDecisions    int
}

type pendingDecision struct {
	candidate ownedCandidate
	kind      AttachKind
	revision  string
	targetIDs []WorkspaceID
	expiresAt time.Time
	sequence  uint64
}

type trustedEvidence struct {
	id     WorkspaceID
	handle DirectoryHandle
}

type Manager struct {
	mu, randomMu    sync.Mutex
	commitMu        sync.Mutex
	store           *registryStore
	clock           func() time.Time
	random          func([]byte) error
	canonicalize    Canonicalizer
	probe           SignatureProbe
	openDirectory   OpenDirectory
	handleSignature HandleSignature
	idSource        func() (WorkspaceID, error)
	ttl             time.Duration
	maxDecisions    int
	sequence        uint64
	pending         map[string]pendingDecision
	trusted         map[string]trustedEvidence
}

func NewManager(configBase string, options Options) (*Manager, error) {
	store, err := newRegistryStore(configBase)
	if err != nil {
		return nil, err
	}
	if options.Clock == nil {
		options.Clock = time.Now
	}
	if options.Random == nil {
		options.Random = func(value []byte) error { _, err := rand.Read(value); return err }
	}
	if options.Canonicalizer == nil {
		options.Canonicalizer = canonicalizeRoot
	}
	if options.OpenDirectory == nil {
		options.OpenDirectory = func(path string) (DirectoryHandle, error) { return os.Open(path) }
	}
	if options.HandleSignature == nil {
		options.HandleSignature = defaultHandleSignature
	}
	if options.DecisionTTL == 0 {
		options.DecisionTTL = DefaultDecisionTTL
	}
	if options.MaxDecisions == 0 {
		options.MaxDecisions = 16
	}
	if options.DecisionTTL < time.Second || options.DecisionTTL > DefaultDecisionTTL ||
		options.MaxDecisions < 1 || options.MaxDecisions > MaxActiveDecisions {
		return nil, errors.New("valid workspace confirmation limits are required")
	}
	m := &Manager{store: store, clock: options.Clock, random: options.Random,
		canonicalize: options.Canonicalizer, probe: options.SignatureProbe,
		openDirectory: options.OpenDirectory, handleSignature: options.HandleSignature,
		ttl: options.DecisionTTL, maxDecisions: options.MaxDecisions, pending: map[string]pendingDecision{}}
	m.trusted = map[string]trustedEvidence{}
	if options.IDSource != nil {
		m.idSource = options.IDSource
	} else {
		hash := options.Hash
		if hash == nil {
			hash = func(value []byte) (string, error) {
				sum := sha256.Sum256(value)
				return hex.EncodeToString(sum[:16]), nil
			}
		}
		m.idSource = func() (WorkspaceID, error) {
			raw := make([]byte, 32)
			m.randomMu.Lock()
			err := m.random(raw)
			m.randomMu.Unlock()
			if err != nil {
				return "", errors.New("create workspace identity failed")
			}
			digest, err := hash(raw)
			for index := range raw {
				raw[index] = 0
			}
			if err != nil || len(digest) < 32 {
				return "", errors.New("create workspace identity failed")
			}
			id := WorkspaceID("ws_" + digest[:32])
			if !id.Valid() {
				return "", errors.New("create workspace identity failed")
			}
			return id, nil
		}
	}
	return m, nil
}

// Lock ordering: Confirm takes commitMu and then the cross-process registry
// lock. Manager.mu is never held while either is acquired. Under the registry
// lock, one reload and one atomic save form the complete durable mutation.
func (m *Manager) validate() error {
	if m == nil || m.store == nil || m.clock == nil || m.random == nil || m.idSource == nil ||
		m.canonicalize == nil || m.openDirectory == nil || m.handleSignature == nil {
		return errors.New("valid workspace identity manager is required")
	}
	return nil
}
