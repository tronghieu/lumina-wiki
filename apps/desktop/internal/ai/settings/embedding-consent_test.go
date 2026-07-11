package settings

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestEmbeddingDimensionsValidationAndFingerprint(t *testing.T) {
	chat := validProfile(RoleChat, ProviderOpenAI)
	chat.Dimensions = 3
	if _, err := chat.Normalized(); err == nil {
		t.Fatal("chat dimensions must be rejected")
	}
	embedding := validProfile(RoleEmbedding, ProviderOpenAI)
	for _, dimensions := range []int{0, 1, MaxEmbeddingDimensions} {
		embedding.Dimensions = dimensions
		if _, err := embedding.Normalized(); err != nil {
			t.Fatalf("dimensions %d: %v", dimensions, err)
		}
	}
	embedding.Dimensions = MaxEmbeddingDimensions + 1
	if _, err := embedding.Normalized(); err == nil {
		t.Fatal("oversized dimensions accepted")
	}
	embedding.Dimensions = 4
	first, _ := embedding.Fingerprint()
	embedding.Dimensions = 5
	second, _ := embedding.Fingerprint()
	if first == second {
		t.Fatal("dimensions must affect fingerprint")
	}
}

func TestEmbeddingConsentRoundTripAndOldConfigCompatibility(t *testing.T) {
	old, err := decodeConfig([]byte(`{"schemaVersion":1}`))
	if err != nil || len(old.EmbeddingConsents) != 0 {
		t.Fatalf("old config: %#v %v", old, err)
	}
	config := DefaultConfig()
	config.EmbeddingConsents = []EmbeddingConsentGrant{{
		WorkspaceID: "ws_0123456789abcdef0123456789abcdef",
		Fingerprint: strings.Repeat("a", 64), DisclosureVersion: 1,
		GrantedAt: time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC),
		ExpiresAt: time.Date(2026, 8, 12, 1, 2, 3, 0, time.UTC),
	}}
	raw, err := encodeConfig(config)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeConfig(raw)
	if err != nil || len(decoded.EmbeddingConsents) != 1 || decoded.EmbeddingConsents[0] != config.EmbeddingConsents[0] {
		t.Fatalf("round trip: %#v %v", decoded, err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil || object["embeddingConsents"] == nil {
		t.Fatalf("missing consent JSON: %s", raw)
	}
}

func TestEmbeddingConsentStrictValidation(t *testing.T) {
	valid := EmbeddingConsentGrant{
		WorkspaceID: "ws_0123456789abcdef0123456789abcdef",
		Fingerprint: strings.Repeat("b", 64), DisclosureVersion: 1,
		GrantedAt: time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC),
	}
	for name, mutate := range map[string]func(*EmbeddingConsentGrant){
		"workspace":   func(g *EmbeddingConsentGrant) { g.WorkspaceID = "bad" },
		"fingerprint": func(g *EmbeddingConsentGrant) { g.Fingerprint = "bad" },
		"disclosure":  func(g *EmbeddingConsentGrant) { g.DisclosureVersion = 0 },
		"granted":     func(g *EmbeddingConsentGrant) { g.GrantedAt = time.Time{} },
		"expiry":      func(g *EmbeddingConsentGrant) { g.ExpiresAt = g.GrantedAt.Add(-time.Second) },
	} {
		t.Run(name, func(t *testing.T) {
			grant := valid
			mutate(&grant)
			config := DefaultConfig()
			config.EmbeddingConsents = []EmbeddingConsentGrant{grant}
			if _, err := config.Normalized(); err == nil {
				t.Fatal("invalid grant accepted")
			}
		})
	}
	duplicate := DefaultConfig()
	duplicate.EmbeddingConsents = []EmbeddingConsentGrant{valid, valid}
	if _, err := duplicate.Normalized(); err == nil {
		t.Fatal("duplicate grant accepted")
	}
	overflow := DefaultConfig()
	overflow.EmbeddingConsents = make([]EmbeddingConsentGrant, MaxEmbeddingConsentGrants+1)
	if _, err := overflow.Normalized(); err == nil {
		t.Fatal("consent cap not enforced")
	}
}

func TestEmbeddingConsentUnknownFieldRejected(t *testing.T) {
	raw := `{"schemaVersion":1,"embeddingConsents":[{"workspaceId":"ws_0123456789abcdef0123456789abcdef","fingerprint":"` + strings.Repeat("a", 64) + `","disclosureVersion":1,"grantedAt":"2026-07-12T01:02:03Z","note":"secret"}]}`
	if _, err := decodeConfig([]byte(raw)); err == nil {
		t.Fatal("unknown consent field accepted")
	}
}
