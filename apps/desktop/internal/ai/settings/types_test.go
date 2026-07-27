package settings

import (
	"strings"
	"testing"
)

func TestDefaultConfigUsesCurrentSchemaVersion(t *testing.T) {
	config := DefaultConfig()
	if config.SchemaVersion != CurrentSchemaVersion {
		t.Fatalf("expected schema version %d, got %d", CurrentSchemaVersion, config.SchemaVersion)
	}
	if config.Chat != nil || config.Embedding != nil {
		t.Fatalf("default config must not invent profiles: %#v", config)
	}
	if err := config.Validate(); err != nil {
		t.Fatalf("default config should validate: %v", err)
	}
}

func TestConfigRejectsUnknownSchemaVersionAndMismatchedRoles(t *testing.T) {
	tests := []struct {
		name   string
		config Config
	}{
		{"unknown config version", Config{SchemaVersion: CurrentSchemaVersion + 1}},
		{"chat slot with embedding role", Config{SchemaVersion: CurrentSchemaVersion, Chat: profilePtr(validProfile(RoleEmbedding, ProviderOpenAI))}},
		{"embedding slot with chat role", Config{SchemaVersion: CurrentSchemaVersion, Embedding: profilePtr(validProfile(RoleChat, ProviderOpenAI))}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.config.Validate(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestProfileProviderRoleCompatibility(t *testing.T) {
	chatProviders := []ProviderKind{ProviderOpenAI, ProviderAnthropic, ProviderGemini, ProviderOpenAICompatible, ProviderOllama}
	for _, provider := range chatProviders {
		if _, err := validProfile(RoleChat, provider).Normalized(); err != nil {
			t.Errorf("chat provider %q should be supported: %v", provider, err)
		}
	}
	embeddingProviders := []ProviderKind{ProviderOpenAI, ProviderGemini, ProviderOpenAICompatible, ProviderOllama}
	for _, provider := range embeddingProviders {
		if _, err := validProfile(RoleEmbedding, provider).Normalized(); err != nil {
			t.Errorf("embedding provider %q should be supported: %v", provider, err)
		}
	}
	if _, err := validProfile(RoleEmbedding, ProviderAnthropic).Normalized(); err == nil {
		t.Fatal("Anthropic embedding profile must be rejected")
	}
	for _, mutate := range []func(*Profile){
		func(p *Profile) { p.SchemaVersion++ },
		func(p *Profile) { p.Role = ProfileRole("rerank") },
		func(p *Profile) { p.Kind = ProviderKind("unknown") },
	} {
		profile := validProfile(RoleChat, ProviderOpenAI)
		mutate(&profile)
		if _, err := profile.Normalized(); err == nil {
			t.Fatal("expected unknown version, role, or provider rejection")
		}
	}
}

func TestProfileValidatesIdentityAndTextFields(t *testing.T) {
	tests := []func(*Profile){
		func(p *Profile) { p.ID = "" },
		func(p *Profile) { p.ID = "bad id" },
		func(p *Profile) { p.Label = "  " },
		func(p *Profile) { p.Label = "bad\nlabel" },
		func(p *Profile) { p.Model = "" },
		func(p *Profile) { p.Model = "bad\x00model" },
	}
	for _, mutate := range tests {
		profile := validProfile(RoleChat, ProviderOpenAI)
		mutate(&profile)
		if _, err := profile.Normalized(); err == nil {
			t.Fatalf("expected invalid profile rejection: %#v", profile)
		}
	}
}

func TestProfileRejectsOverlongPersistedStrings(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Profile)
	}{
		{"ID", func(p *Profile) { p.ID = strings.Repeat("a", MaxProfileIDBytes+1) }},
		{"label", func(p *Profile) { p.Label = strings.Repeat("a", MaxLabelBytes+1) }},
		{"model", func(p *Profile) { p.Model = strings.Repeat("a", MaxModelBytes+1) }},
		{"base URL", func(p *Profile) { p.BaseURL = "https://example.com/" + strings.Repeat("a", MaxBaseURLBytes) }},
		{"credential reference", func(p *Profile) { p.CredentialRef = strings.Repeat("a", MaxCredentialRefBytes+1) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			profile := validProfile(RoleChat, ProviderOpenAI)
			test.mutate(&profile)
			if _, err := profile.Normalized(); err == nil {
				t.Fatal("expected overlong value rejection")
			}
		})
	}
}

func TestBaseURLNormalizationAndSecurity(t *testing.T) {
	profile := validProfile(RoleChat, ProviderOpenAICompatible)
	profile.BaseURL = "HTTPS://Example.COM:443/v1/?z=last&a=first"
	normalized, err := profile.Normalized()
	if err != nil {
		t.Fatalf("Normalized returned error: %v", err)
	}
	if normalized.BaseURL != "https://example.com/v1?a=first&z=last" {
		t.Fatalf("unexpected normalized URL: %q", normalized.BaseURL)
	}

	allowed := []string{"http://127.0.0.1:11434/v1", "http://[::1]:11434", "https://api.example.com/v1"}
	for _, baseURL := range allowed {
		profile.BaseURL = baseURL
		if _, err := profile.Normalized(); err != nil {
			t.Errorf("expected URL %q to be allowed: %v", baseURL, err)
		}
	}
	rejected := []string{
		"http://example.com/v1",
		"http://localhost:11434/v1",
		"ftp://example.com/v1",
		"https://user:pass@example.com/v1",
		"https://example.com/v1#fragment",
		"https://example.com/v1?api_key=secret",
		"https://example.com/v1?access-token=secret",
		"https://example.com/v1?token=secret",
		"https://example.com/v1?secret=secret",
		"https://example.com/v1?X-Amz-Signature=secret",
		"https:///v1",
	}
	for _, baseURL := range rejected {
		profile.BaseURL = baseURL
		if _, err := profile.Normalized(); err == nil {
			t.Errorf("expected URL %q to be rejected", baseURL)
		}
	}
}

func TestBaseURLPortBounds(t *testing.T) {
	profile := validProfile(RoleChat, ProviderOpenAICompatible)
	allowed := []string{
		"https://example.com:1/v1",
		"https://example.com:65535/v1",
		"http://127.0.0.1:1/v1",
		"http://[::1]:65535/v1",
	}
	for _, baseURL := range allowed {
		t.Run("allow_"+baseURL, func(t *testing.T) {
			profile.BaseURL = baseURL
			if _, err := profile.Normalized(); err != nil {
				t.Fatalf("expected valid explicit port: %v", err)
			}
		})
	}
	rejected := []string{
		"https://example.com:/v1",
		"https://example.com:0/v1",
		"https://example.com:65536/v1",
		"https://example.com:abc/v1",
		"http://[::1]:/v1",
		"http://[::1]:0/v1",
		"http://[::1]:65536/v1",
	}
	for _, baseURL := range rejected {
		t.Run("reject_"+baseURL, func(t *testing.T) {
			profile.BaseURL = baseURL
			if _, err := profile.Normalized(); err == nil {
				t.Fatal("expected invalid explicit port rejection")
			}
		})
	}
}

func TestCredentialLikeQueryKeyPolicy(t *testing.T) {
	profile := validProfile(RoleChat, ProviderOpenAICompatible)
	dangerous := []string{
		"access_key", "access-key", "AWSAccessKeyId", "api_key", "api-key",
		"auth", "authentication", "authorization", "auth_token", "clientSecret",
		"password", "bearer-token", "refreshToken", "x-amz-credential",
	}
	for _, key := range dangerous {
		t.Run("reject_"+key, func(t *testing.T) {
			profile.BaseURL = "https://example.com/v1?" + key + "=value"
			if _, err := profile.Normalized(); err == nil {
				t.Fatalf("expected credential-like query key %q to be rejected", key)
			}
		})
	}
	ordinary := []string{
		"author", "authority", "accessibility", "keyboard", "monkey",
		"api_version", "format", "organization", "secretary", "passwordless", "tokenizer",
	}
	for _, key := range ordinary {
		t.Run("allow_"+key, func(t *testing.T) {
			profile.BaseURL = "https://example.com/v1?" + key + "=value"
			if _, err := profile.Normalized(); err != nil {
				t.Fatalf("ordinary query key %q should be allowed: %v", key, err)
			}
		})
	}
}

func TestBaseURLRejectsMalformedRawQuery(t *testing.T) {
	profile := validProfile(RoleChat, ProviderOpenAICompatible)
	malformed := []string{
		"api_key=secret;foo=bar",
		"good=value;bad=value",
		"value=%zz",
		"value=%",
	}
	for _, rawQuery := range malformed {
		t.Run(rawQuery, func(t *testing.T) {
			profile.BaseURL = "https://example.com/v1?" + rawQuery
			if _, err := profile.Normalized(); err == nil {
				t.Fatalf("expected malformed query %q to be rejected", rawQuery)
			}
		})
	}
}

func TestProfileBudgetBounds(t *testing.T) {
	tests := []func(*Profile){
		func(p *Profile) { p.TimeoutMS = MinTimeoutMS - 1 },
		func(p *Profile) { p.TimeoutMS = MaxTimeoutMS + 1 },
		func(p *Profile) { p.MaxInputChars = MinInputChars - 1 },
		func(p *Profile) { p.MaxInputChars = MaxInputChars + 1 },
		func(p *Profile) { p.MaxHistoryChars = MinHistoryChars - 1 },
		func(p *Profile) { p.MaxHistoryChars = MaxHistoryChars + 1 },
		func(p *Profile) { p.MaxEvidenceChars = MinEvidenceChars - 1 },
		func(p *Profile) { p.MaxEvidenceChars = MaxEvidenceChars + 1 },
		func(p *Profile) { p.MaxOutputTokens = MinOutputTokens - 1 },
		func(p *Profile) { p.MaxOutputTokens = MaxOutputTokens + 1 },
	}
	for _, mutate := range tests {
		profile := validProfile(RoleChat, ProviderOpenAI)
		mutate(&profile)
		if _, err := profile.Normalized(); err == nil {
			t.Fatalf("expected out-of-range budget rejection: %#v", profile)
		}
	}
}

func TestFingerprintIsStableAndExcludesCredentialReference(t *testing.T) {
	first := validProfile(RoleChat, ProviderOpenAICompatible)
	first.BaseURL = "https://EXAMPLE.com:443/v1/?z=2&a=1"
	first.CredentialRef = "keyring:first"
	second := first
	second.BaseURL = "https://example.com/v1?a=1&z=2"
	second.CredentialRef = "keyring:rotated"

	fingerprint, err := first.Fingerprint()
	if err != nil {
		t.Fatalf("Fingerprint returned error: %v", err)
	}
	other, err := second.Fingerprint()
	if err != nil {
		t.Fatalf("Fingerprint returned error: %v", err)
	}
	if fingerprint != other || len(fingerprint) != 64 {
		t.Fatalf("expected stable SHA-256 fingerprint, got %q and %q", fingerprint, other)
	}

	mutations := []struct {
		name   string
		mutate func(*Profile)
	}{
		{"provider", func(p *Profile) { p.Kind = ProviderOllama }},
		{"model", func(p *Profile) { p.Model = "different-model" }},
		{"base URL", func(p *Profile) { p.BaseURL = "https://other.example/v1" }},
		{"timeout", func(p *Profile) { p.TimeoutMS++ }},
		{"input budget", func(p *Profile) { p.MaxInputChars++ }},
		{"history budget", func(p *Profile) { p.MaxHistoryChars++ }},
		{"evidence budget", func(p *Profile) { p.MaxEvidenceChars++ }},
		{"output budget", func(p *Profile) { p.MaxOutputTokens++ }},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			changed := second
			mutation.mutate(&changed)
			changedFingerprint, err := changed.Fingerprint()
			if err != nil {
				t.Fatalf("changed Fingerprint returned error: %v", err)
			}
			if changedFingerprint == fingerprint {
				t.Fatal("effective profile change must alter fingerprint")
			}
		})
	}
	if strings.Contains(fingerprint, first.CredentialRef) {
		t.Fatal("fingerprint must never expose credential reference")
	}
}

func validProfile(role ProfileRole, provider ProviderKind) Profile {
	return Profile{
		SchemaVersion:    CurrentProfileSchemaVersion,
		ID:               "primary-profile",
		Role:             role,
		Kind:             provider,
		Label:            "Primary",
		Model:            "model-1",
		BaseURL:          "https://api.example.com/v1",
		CredentialRef:    "keyring:primary",
		TimeoutMS:        30_000,
		MaxInputChars:    200_000,
		MaxHistoryChars:  100_000,
		MaxEvidenceChars: 100_000,
		MaxOutputTokens:  8_000,
	}
}

func profilePtr(profile Profile) *Profile { return &profile }
