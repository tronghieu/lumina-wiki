package settings

import (
	"errors"
	"regexp"
	"sort"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

const MaxEmbeddingConsentGrants = 256

var consentFingerprintPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type EmbeddingConsentState string

const (
	EmbeddingConsentPending   EmbeddingConsentState = "pending"
	EmbeddingConsentCommitted EmbeddingConsentState = "committed"
)

type EmbeddingConsentGrant struct {
	WorkspaceID       string                `json:"workspaceId"`
	Fingerprint       string                `json:"fingerprint"`
	DisclosureVersion int                   `json:"disclosureVersion"`
	State             EmbeddingConsentState `json:"state,omitempty"`
	GrantedAt         time.Time             `json:"grantedAt"`
	ExpiresAt         time.Time             `json:"expiresAt,omitempty"`
	RevokedAt         time.Time             `json:"revokedAt,omitempty"`
}

func normalizeEmbeddingConsents(source []EmbeddingConsentGrant) ([]EmbeddingConsentGrant, error) {
	if len(source) > MaxEmbeddingConsentGrants {
		return nil, errors.New("too many embedding consent grants")
	}
	result := append([]EmbeddingConsentGrant(nil), source...)
	seen := make(map[string]struct{}, len(result))
	for i := range result {
		grant := &result[i]
		if grant.State == "" {
			grant.State = EmbeddingConsentCommitted
		}
		if !workspaceid.WorkspaceID(grant.WorkspaceID).Valid() || !consentFingerprintPattern.MatchString(grant.Fingerprint) || grant.DisclosureVersion <= 0 || grant.GrantedAt.IsZero() {
			return nil, errors.New("embedding consent grant is invalid")
		}
		if grant.State != EmbeddingConsentPending && grant.State != EmbeddingConsentCommitted {
			return nil, errors.New("embedding consent state is invalid")
		}
		grant.GrantedAt = grant.GrantedAt.UTC()
		grant.ExpiresAt = grant.ExpiresAt.UTC()
		grant.RevokedAt = grant.RevokedAt.UTC()
		if !grant.ExpiresAt.IsZero() && !grant.ExpiresAt.After(grant.GrantedAt) || !grant.RevokedAt.IsZero() && grant.RevokedAt.Before(grant.GrantedAt) {
			return nil, errors.New("embedding consent timestamps are invalid")
		}
		key := grant.WorkspaceID + "\x00" + grant.Fingerprint
		if _, exists := seen[key]; exists {
			return nil, errors.New("duplicate embedding consent grant")
		}
		seen[key] = struct{}{}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].WorkspaceID != result[j].WorkspaceID {
			return result[i].WorkspaceID < result[j].WorkspaceID
		}
		return result[i].Fingerprint < result[j].Fingerprint
	})
	return result, nil
}
