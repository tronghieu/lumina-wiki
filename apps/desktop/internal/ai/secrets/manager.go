package secrets

import (
	"crypto/rand"
	"errors"
	"io"
	"sync"
	"time"
)

const (
	defaultChallengeTTL = 5 * time.Minute
	defaultChallengeCap = 16
	MaxActiveChallenges = 64
	nonceBytes          = 32
)

type ManagerOptions struct {
	Clock         func() time.Time
	Random        io.Reader
	ChallengeTTL  time.Duration
	MaxChallenges int
}

type pendingChallenge struct {
	ref       string
	reason    CredentialStatus
	expiresAt time.Time
	sequence  uint64
}
type referenceLock struct {
	gate  chan struct{}
	users int
}

type Manager struct {
	mu            sync.Mutex
	randomMu      sync.Mutex
	persistent    SecretStore
	clock         func() time.Time
	random        io.Reader
	ttl           time.Duration
	maxChallenges int
	sequence      uint64
	challenges    map[string]pendingChallenge
	session       map[string][]byte
	// known caches state only; secret bytes remain in session/store.
	known map[string]CredentialStatus
	locks map[string]*referenceLock
}

func NewManager(persistent SecretStore, options ManagerOptions) (*Manager, error) {
	if persistent == nil {
		return nil, errors.New("persistent secret store is required")
	}
	if options.Clock == nil {
		options.Clock = time.Now
	}
	if options.Random == nil {
		options.Random = rand.Reader
	}
	if options.ChallengeTTL == 0 {
		options.ChallengeTTL = defaultChallengeTTL
	}
	if options.MaxChallenges == 0 {
		options.MaxChallenges = defaultChallengeCap
	}
	if options.MaxChallenges > MaxActiveChallenges {
		options.MaxChallenges = MaxActiveChallenges
	}
	if options.ChallengeTTL < 0 || options.ChallengeTTL > defaultChallengeTTL || options.MaxChallenges < 1 {
		return nil, errors.New("valid session challenge limits are required")
	}
	return &Manager{persistent: persistent, clock: options.Clock, random: options.Random, ttl: options.ChallengeTTL,
		maxChallenges: options.MaxChallenges, challenges: map[string]pendingChallenge{}, session: map[string][]byte{},
		known: map[string]CredentialStatus{}, locks: map[string]*referenceLock{}}, nil
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
