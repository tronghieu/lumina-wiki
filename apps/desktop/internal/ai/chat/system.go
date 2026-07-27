package chat

import "encoding/json"

const (
	evidenceBegin = "\n\nBEGIN_LUMINA_EVIDENCE_JSONL\n"
	evidenceEnd   = "END_LUMINA_EVIDENCE_JSONL"
)

type promptEvidence struct {
	ID      string `json:"id"`
	Path    string `json:"path"`
	Heading string `json:"heading"`
	Text    string `json:"text"`
}

func emptyEvidenceSystem() string { return FixedSystemRules + evidenceBegin + evidenceEnd }

func evidenceJSONLine(entry evidenceEntry) string {
	raw, _ := json.Marshal(promptEvidence{ID: entry.ModelID, Path: entry.Path, Heading: entry.Heading, Text: entry.Text})
	return string(raw) + "\n"
}

func evidenceSystem(lines []string) string {
	result := FixedSystemRules + evidenceBegin
	for _, line := range lines {
		result += line
	}
	return result + evidenceEnd
}

func (allowlist *EvidenceAllowlist) snapshotEntries() ([]evidenceEntry, error) {
	allowlist.mu.RLock()
	defer allowlist.mu.RUnlock()
	if allowlist.closed {
		return nil, ErrEvidenceClosed
	}
	result := make([]evidenceEntry, len(allowlist.entries))
	copy(result, allowlist.entries)
	return result, nil
}
