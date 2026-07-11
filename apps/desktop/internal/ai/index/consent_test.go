package index

import (
	"errors"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

var testWorkspace = workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef")

func embeddingProfile(kind settings.ProviderKind, endpoint string) settings.Profile {
	return settings.Profile{SchemaVersion: 1, ID: "embedding", Role: settings.RoleEmbedding, Kind: kind,
		Label: "Embedding", Model: "embed-model", BaseURL: endpoint, CredentialRef: "keyring:embed",
		TimeoutMS: 1000, MaxInputChars: 1000, MaxHistoryChars: 0, MaxEvidenceChars: 0, MaxOutputTokens: 1, Dimensions: 3}
}

func TestConsentFingerprintRemoteLocalAndExcludedMetadata(t *testing.T) {
	remote := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	disclosure, err := ConsentFingerprint(testWorkspace, remote)
	if err != nil || disclosure.Kind != DisclosureRemote || len(disclosure.Fingerprint) != 64 {
		t.Fatalf("remote disclosure: %#v %v", disclosure, err)
	}
	local := embeddingProfile(settings.ProviderOllama, "http://127.0.0.1:11434/v1")
	localDisclosure, err := ConsentFingerprint(testWorkspace, local)
	if err != nil || localDisclosure.Kind != DisclosureLocal || localDisclosure.Fingerprint == disclosure.Fingerprint {
		t.Fatalf("local disclosure: %#v %v", localDisclosure, err)
	}
	changedMetadata := remote
	changedMetadata.ID, changedMetadata.Label, changedMetadata.CredentialRef = "other", "Other", "keyring:rotated"
	same, _ := ConsentFingerprint(testWorkspace, changedMetadata)
	if same.Fingerprint != disclosure.Fingerprint {
		t.Fatal("profile metadata or credential rotation changed consent")
	}
}

func TestConsentRequiresExactCurrentUnexpiredGrant(t *testing.T) {
	now := time.Date(2026, 7, 12, 1, 0, 0, 0, time.UTC)
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	config := settings.DefaultConfig()
	if err := RequireConsent(config, testWorkspace, profile, now); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("missing grant: %v", err)
	}
	granted, err := GrantConsent(config, testWorkspace, profile, now, now.Add(time.Hour))
	if err != nil || RequireConsent(granted, testWorkspace, profile, now.Add(time.Minute)) != nil {
		t.Fatalf("grant failed: %v", err)
	}
	for name, mutate := range map[string]func(*settings.Profile){
		"kind":       func(p *settings.Profile) { p.Kind = settings.ProviderGemini },
		"endpoint":   func(p *settings.Profile) { p.BaseURL = "https://other.example/v1" },
		"model":      func(p *settings.Profile) { p.Model = "other-model" },
		"dimensions": func(p *settings.Profile) { p.Dimensions++ },
	} {
		t.Run(name, func(t *testing.T) {
			changed := profile
			mutate(&changed)
			if err := RequireConsent(granted, testWorkspace, changed, now); !errors.Is(err, ErrConsentRequired) {
				t.Fatalf("drift accepted: %v", err)
			}
		})
	}
	otherWorkspace := workspaceid.WorkspaceID("ws_fedcba9876543210fedcba9876543210")
	if err := RequireConsent(granted, otherWorkspace, profile, now); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("workspace drift accepted: %v", err)
	}
	if err := RequireConsent(granted, testWorkspace, profile, now.Add(2*time.Hour)); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("expired grant accepted: %v", err)
	}
	revoked, err := RevokeConsent(granted, testWorkspace, profile, now.Add(2*time.Minute))
	if err != nil || !errors.Is(RequireConsent(revoked, testWorkspace, profile, now.Add(3*time.Minute)), ErrConsentRequired) {
		t.Fatalf("revocation failed: %v", err)
	}
}

func TestGrantConsentPreservesProfilesAndReplacesSameGrant(t *testing.T) {
	now := time.Date(2026, 7, 12, 1, 0, 0, 0, time.UTC)
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	config := settings.DefaultConfig()
	config.Chat = func() *settings.Profile { p := profile; p.Role = settings.RoleChat; p.Dimensions = 0; return &p }()
	first, err := GrantConsent(config, testWorkspace, profile, now, time.Time{})
	second, err2 := GrantConsent(first, testWorkspace, profile, now.Add(time.Minute), time.Time{})
	if err != nil || err2 != nil || second.Chat == nil || len(second.EmbeddingConsents) != 1 || !second.EmbeddingConsents[0].GrantedAt.Equal(now.Add(time.Minute)) {
		t.Fatalf("update failed: %#v %v %v", second, err, err2)
	}
}

func TestConsentGrantTimeAndExpiryBoundaries(t *testing.T) {
	grantedAt := time.Date(2026, 7, 12, 1, 0, 0, 0, time.UTC)
	expiresAt := grantedAt.Add(time.Hour)
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	config, err := GrantConsent(settings.DefaultConfig(), testWorkspace, profile, grantedAt, expiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if !errors.Is(RequireConsent(config, testWorkspace, profile, time.Time{}), ErrConsentRequired) {
		t.Fatal("zero now accepted")
	}
	if !errors.Is(RequireConsent(config, testWorkspace, profile, grantedAt.Add(-time.Nanosecond)), ErrConsentRequired) {
		t.Fatal("future grant accepted")
	}
	if err := RequireConsent(config, testWorkspace, profile, grantedAt); err != nil {
		t.Fatalf("grant boundary rejected: %v", err)
	}
	if err := RequireConsent(config, testWorkspace, profile, expiresAt.Add(-time.Nanosecond)); err != nil {
		t.Fatalf("pre-expiry rejected: %v", err)
	}
	if !errors.Is(RequireConsent(config, testWorkspace, profile, expiresAt), ErrConsentRequired) {
		t.Fatal("expiry boundary accepted")
	}
}
