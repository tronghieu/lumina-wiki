package chat

type CitationLeaseRun struct {
	registry   *CitationLeaseRegistry
	scopeID    string
	generation uint64
}

func (registry *CitationLeaseRegistry) Begin(scopeID string) (*CitationLeaseRun, error) {
	if registry == nil || !validRunID(scopeID) {
		return nil, ErrInvalidRequest
	}
	registry.mu.Lock()
	if registry.closed {
		registry.mu.Unlock()
		return nil, ErrCitationLeaseClosed
	}
	if registry.active[scopeID] != 0 {
		registry.mu.Unlock()
		return nil, ErrCitationRequestActive
	}
	registry.next++
	generation := registry.next
	registry.active[scopeID] = generation
	old := registry.leases[scopeID]
	delete(registry.leases, scopeID)
	registry.mu.Unlock()
	if old != nil {
		old.Close()
	}
	return &CitationLeaseRun{registry: registry, scopeID: scopeID, generation: generation}, nil
}

func (run *CitationLeaseRun) Replace(lease *CitationLease) error {
	if run == nil || lease == nil {
		return ErrInvalidRequest
	}
	registry := run.registry
	registry.mu.Lock()
	if registry.closed || registry.active[run.scopeID] != run.generation {
		registry.mu.Unlock()
		lease.Close()
		return ErrCitationRequestActive
	}
	old := registry.leases[run.scopeID]
	registry.leases[run.scopeID] = lease
	registry.mu.Unlock()
	if old != nil {
		old.Close()
	}
	return nil
}

func (run *CitationLeaseRun) Revoke() {
	if run == nil {
		return
	}
	registry := run.registry
	registry.mu.Lock()
	var lease *CitationLease
	if registry.active[run.scopeID] == run.generation {
		lease = registry.leases[run.scopeID]
		delete(registry.leases, run.scopeID)
	}
	registry.mu.Unlock()
	if lease != nil {
		lease.Close()
	}
}

func (run *CitationLeaseRun) End() {
	if run == nil {
		return
	}
	registry := run.registry
	registry.mu.Lock()
	if registry.active[run.scopeID] == run.generation {
		delete(registry.active, run.scopeID)
	}
	registry.mu.Unlock()
}
