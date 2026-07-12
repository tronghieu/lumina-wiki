package chat

const (
	MaxCitationCandidates = 4096
	MaxDiagnosticKeys     = 256
)

type citationTokenKey struct {
	hashA, hashB uint64
	length       int
}

func (allowlist *EvidenceAllowlist) Extract(text string) (CitationExtraction, error) {
	return allowlist.extractWithAllowed(text, nil)
}

func (allowlist *EvidenceAllowlist) extractWithAllowed(text string, allowed map[string]bool) (CitationExtraction, error) {
	if !validAssistantText(text) {
		return CitationExtraction{}, ErrInvalidAssistantText
	}
	allowlist.mu.RLock()
	defer allowlist.mu.RUnlock()
	if allowlist.closed {
		return CitationExtraction{}, ErrEvidenceClosed
	}
	result := CitationExtraction{Citations: []CitationDTO{}}
	diagnosticKeys := make(map[citationTokenKey]bool, MaxDiagnosticKeys)
	var seenIDs [MaxEvidenceEntries + 1]bool
	for offset, scanned := 0, 0; offset < len(text) && scanned < MaxCitationCandidates; offset++ {
		if text[offset] != '[' {
			continue
		}
		start, end, closed := offset, offset+1, false
		for end < len(text) {
			if text[end] == ']' {
				end++
				closed = true
				break
			}
			end++
		}
		scanned++
		kind, number := classifyCitationToken(text, start, end, closed)
		if kind == "valid" {
			if !seenIDs[number] {
				seenIDs[number] = true
				id := modelEvidenceID(number)
				if allowed != nil && !allowed[id] {
					result.UnknownCount++
				} else if entry, ok := allowlist.byID[id]; ok {
					result.Citations = append(result.Citations, entry.dto())
				} else {
					result.UnknownCount++
				}
			}
			offset = end - 1
			continue
		}
		key := tokenKey(text, start, end)
		if diagnosticKeys[key] || len(diagnosticKeys) >= MaxDiagnosticKeys {
			offset = end - 1
			continue
		}
		diagnosticKeys[key] = true
		switch kind {
		case "out":
			result.OutOfRangeCount++
		default:
			result.MalformedCount++
		}
		offset = end - 1
	}
	result.ValidCount = len(result.Citations)
	return result, nil
}

func classifyCitationToken(text string, start, end int, closed bool) (string, int) {
	if !closed || end-start < 4 || text[start+1] != 'S' {
		return "malformed", 0
	}
	digitEnd := end - 1
	if digitEnd == start+2 {
		return "malformed", 0
	}
	value, out := 0, false
	for index := start + 2; index < digitEnd; index++ {
		digit := text[index]
		if digit < '0' || digit > '9' {
			return "malformed", 0
		}
		if index == start+2 && digit == '0' && digitEnd-index > 1 {
			return "malformed", 0
		}
		if !out {
			if value > (MaxEvidenceEntries-int(digit-'0'))/10 {
				out = true
			} else {
				value = value*10 + int(digit-'0')
			}
		}
	}
	if out || value == 0 || value > MaxEvidenceEntries {
		return "out", 0
	}
	return "valid", value
}

func tokenKey(text string, start, end int) citationTokenKey {
	a, b := uint64(1469598103934665603), uint64(1099511628211)
	for index := start; index < end; index++ {
		value := uint64(text[index])
		a = (a ^ value) * 1099511628211
		b = (b + value + 0x9e3779b97f4a7c15) * 0x100000001b3
	}
	return citationTokenKey{hashA: a, hashB: b, length: end - start}
}
