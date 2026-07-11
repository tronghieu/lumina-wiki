package index

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"net/url"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

const CurrentDisclosureVersion = 1

var ErrConsentRequired = errors.New("embedding consent is required")

type DisclosureKind string

const (
	DisclosureRemote DisclosureKind = "remote_recipient"
	DisclosureLocal  DisclosureKind = "local_cpu_disk"
)

type ConsentDisclosure struct {
	Fingerprint string
	Kind        DisclosureKind
	Version     int
}

func ConsentFingerprint(workspace workspaceid.WorkspaceID, profile settings.Profile) (ConsentDisclosure, error) {
	if !workspace.Valid() {
		return ConsentDisclosure{}, errors.New("workspace identity is invalid")
	}
	profile, err := profile.Normalized()
	if err != nil || profile.Role != settings.RoleEmbedding {
		return ConsentDisclosure{}, errors.New("embedding profile is invalid")
	}
	u, err := url.Parse(profile.BaseURL)
	if err != nil {
		return ConsentDisclosure{}, errors.New("embedding profile is invalid")
	}
	kind := DisclosureRemote
	if address, parseErr := netip.ParseAddr(u.Hostname()); parseErr == nil && address.IsLoopback() {
		kind = DisclosureLocal
	}
	canonical := struct {
		Version    int                     `json:"version"`
		Workspace  workspaceid.WorkspaceID `json:"workspace"`
		Disclosure DisclosureKind          `json:"disclosure"`
		Provider   settings.ProviderKind   `json:"provider"`
		Endpoint   string                  `json:"endpoint"`
		Model      string                  `json:"model"`
		Dimensions int                     `json:"dimensions"`
	}{CurrentDisclosureVersion, workspace, kind, profile.Kind, profile.BaseURL, profile.Model, profile.Dimensions}
	raw, _ := json.Marshal(canonical)
	sum := sha256.Sum256(raw)
	return ConsentDisclosure{Fingerprint: hex.EncodeToString(sum[:]), Kind: kind, Version: CurrentDisclosureVersion}, nil
}

func RequireConsent(config settings.Config, workspace workspaceid.WorkspaceID, profile settings.Profile, now time.Time) error {
	if now.IsZero() {
		return ErrConsentRequired
	}
	config, err := config.Normalized()
	if err != nil {
		return err
	}
	disclosure, err := ConsentFingerprint(workspace, profile)
	if err != nil {
		return err
	}
	for _, grant := range config.EmbeddingConsents {
		if grant.WorkspaceID == string(workspace) && grant.Fingerprint == disclosure.Fingerprint && grant.DisclosureVersion == disclosure.Version && !now.Before(grant.GrantedAt) && grant.RevokedAt.IsZero() && (grant.ExpiresAt.IsZero() || now.Before(grant.ExpiresAt)) {
			return nil
		}
	}
	return ErrConsentRequired
}

func GrantConsent(config settings.Config, workspace workspaceid.WorkspaceID, profile settings.Profile, grantedAt, expiresAt time.Time) (settings.Config, error) {
	config, err := config.Normalized()
	if err != nil {
		return settings.Config{}, err
	}
	disclosure, err := ConsentFingerprint(workspace, profile)
	if err != nil || grantedAt.IsZero() || !expiresAt.IsZero() && !expiresAt.After(grantedAt) {
		return settings.Config{}, errors.New("embedding consent grant is invalid")
	}
	grant := settings.EmbeddingConsentGrant{WorkspaceID: string(workspace), Fingerprint: disclosure.Fingerprint, DisclosureVersion: disclosure.Version, GrantedAt: grantedAt.UTC(), ExpiresAt: expiresAt.UTC()}
	filtered := config.EmbeddingConsents[:0]
	for _, existing := range config.EmbeddingConsents {
		if existing.WorkspaceID != grant.WorkspaceID || existing.Fingerprint != grant.Fingerprint {
			filtered = append(filtered, existing)
		}
	}
	config.EmbeddingConsents = append(filtered, grant)
	return config.Normalized()
}

func RevokeConsent(config settings.Config, workspace workspaceid.WorkspaceID, profile settings.Profile, revokedAt time.Time) (settings.Config, error) {
	config, err := config.Normalized()
	if err != nil {
		return settings.Config{}, err
	}
	disclosure, err := ConsentFingerprint(workspace, profile)
	if err != nil || revokedAt.IsZero() {
		return settings.Config{}, errors.New("embedding consent revocation is invalid")
	}
	found := false
	for i := range config.EmbeddingConsents {
		grant := &config.EmbeddingConsents[i]
		if grant.WorkspaceID == string(workspace) && grant.Fingerprint == disclosure.Fingerprint {
			grant.RevokedAt = revokedAt.UTC()
			found = true
		}
	}
	if !found {
		return settings.Config{}, ErrConsentRequired
	}
	return config.Normalized()
}
