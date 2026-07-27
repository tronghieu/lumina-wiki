package chat

import (
	"context"
	"errors"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

var (
	ErrUnknownCitationLease  = errors.New("unknown citation lease")
	ErrCitationLeaseClosed   = errors.New("citation lease closed")
	ErrCitationRequestActive = errors.New("citation request already active")
)

type CitationLease struct {
	mu        sync.RWMutex
	allowlist *EvidenceAllowlist
	allowed   map[string]bool
	closed    bool
}

func NewCitationLease(scope *EvidenceScope, citations []CitationDTO) (*CitationLease, error) {
	if scope == nil || scope.allowlist == nil || len(citations) > MaxEvidenceEntries {
		return nil, ErrInvalidEvidenceInput
	}
	scope.allowlist.mu.RLock()
	defer scope.allowlist.mu.RUnlock()
	if scope.allowlist.closed {
		return nil, ErrEvidenceClosed
	}
	allowed := make(map[string]bool, len(citations))
	for _, citation := range citations {
		if !scope.allowed[citation.ModelID] {
			return nil, ErrUnknownEvidence
		}
		entry, ok := scope.allowlist.byID[citation.ModelID]
		if !ok || entry.CitationID != citation.CitationID {
			return nil, ErrUnknownEvidence
		}
		allowed[citation.CitationID] = true
	}
	return &CitationLease{allowlist: scope.allowlist, allowed: allowed}, nil
}

func (lease *CitationLease) ReadCitationNote(ctx context.Context, citationID string) (retrieval.CitationNote, error) {
	lease.mu.RLock()
	if lease.closed {
		lease.mu.RUnlock()
		return retrieval.CitationNote{}, ErrCitationLeaseClosed
	}
	if !lease.allowed[citationID] {
		lease.mu.RUnlock()
		return retrieval.CitationNote{}, ErrUnknownCitationLease
	}
	allowlist := lease.allowlist
	lease.mu.RUnlock()
	note, err := allowlist.ReadCitationNote(ctx, citationID)
	if errors.Is(err, retrieval.ErrCitationClosed) || errors.Is(err, ErrEvidenceClosed) {
		return retrieval.CitationNote{}, ErrCitationLeaseClosed
	}
	return note, err
}

func (lease *CitationLease) Close() {
	if lease == nil {
		return
	}
	lease.mu.Lock()
	if lease.closed {
		lease.mu.Unlock()
		return
	}
	lease.closed = true
	allowlist := lease.allowlist
	lease.allowlist, lease.allowed = nil, nil
	lease.mu.Unlock()
	allowlist.Close()
}

type CitationLeaseRegistry struct {
	mu     sync.RWMutex
	leases map[string]*CitationLease
	closed bool
	active map[string]uint64
	next   uint64
}

func NewCitationLeaseRegistry() *CitationLeaseRegistry {
	return &CitationLeaseRegistry{leases: map[string]*CitationLease{}, active: map[string]uint64{}}
}

func (registry *CitationLeaseRegistry) Replace(scopeID string, lease *CitationLease) error {
	if registry == nil || !validRunID(scopeID) || lease == nil {
		return ErrInvalidRequest
	}
	registry.mu.Lock()
	if registry.closed {
		registry.mu.Unlock()
		lease.Close()
		return ErrCitationLeaseClosed
	}
	if registry.active[scopeID] != 0 {
		registry.mu.Unlock()
		lease.Close()
		return ErrCitationRequestActive
	}
	old := registry.leases[scopeID]
	registry.leases[scopeID] = lease
	registry.mu.Unlock()
	if old != nil {
		old.Close()
	}
	return nil
}

func (registry *CitationLeaseRegistry) ReadCitationNote(ctx context.Context, scopeID, citationID string) (retrieval.CitationNote, error) {
	if registry == nil {
		return retrieval.CitationNote{}, ErrUnknownCitationLease
	}
	registry.mu.RLock()
	lease := registry.leases[scopeID]
	registry.mu.RUnlock()
	if lease == nil {
		return retrieval.CitationNote{}, ErrUnknownCitationLease
	}
	return lease.ReadCitationNote(ctx, citationID)
}

func (registry *CitationLeaseRegistry) Revoke(scopeID string) {
	if registry == nil {
		return
	}
	registry.mu.Lock()
	delete(registry.active, scopeID)
	lease := registry.leases[scopeID]
	delete(registry.leases, scopeID)
	registry.mu.Unlock()
	if lease != nil {
		lease.Close()
	}
}

func (registry *CitationLeaseRegistry) Close() {
	if registry == nil {
		return
	}
	registry.mu.Lock()
	if registry.closed {
		registry.mu.Unlock()
		return
	}
	registry.closed = true
	leases := registry.leases
	registry.leases = nil
	registry.mu.Unlock()
	for _, lease := range leases {
		lease.Close()
	}
}
