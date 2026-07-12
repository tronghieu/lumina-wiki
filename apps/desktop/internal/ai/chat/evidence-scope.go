package chat

type EvidenceScope struct {
	allowlist *EvidenceAllowlist
	allowed   map[string]bool
}

func NewEvidenceScope(allowlist *EvidenceAllowlist, ids []string) (*EvidenceScope, error) {
	if allowlist == nil || len(ids) > MaxEvidenceEntries {
		return nil, ErrInvalidEvidenceInput
	}
	allowlist.mu.RLock()
	defer allowlist.mu.RUnlock()
	if allowlist.closed {
		return nil, ErrEvidenceClosed
	}
	scope := &EvidenceScope{allowlist: allowlist, allowed: make(map[string]bool, len(ids))}
	for _, id := range ids {
		if _, ok := allowlist.byID[id]; !ok {
			return nil, ErrUnknownEvidence
		}
		scope.allowed[id] = true
	}
	return scope, nil
}

func (scope *EvidenceScope) citationDTOs() []CitationDTO {
	if scope == nil || scope.allowlist == nil {
		return []CitationDTO{}
	}
	scope.allowlist.mu.RLock()
	defer scope.allowlist.mu.RUnlock()
	result := make([]CitationDTO, 0, len(scope.allowed))
	for _, entry := range scope.allowlist.entries {
		if scope.allowed[entry.ModelID] {
			result = append(result, entry.dto())
		}
	}
	return result
}

func (scope *EvidenceScope) Extract(text string) (CitationExtraction, error) {
	if scope == nil || scope.allowlist == nil {
		return CitationExtraction{}, ErrInvalidEvidenceInput
	}
	return scope.allowlist.extractWithAllowed(text, scope.allowed)
}
