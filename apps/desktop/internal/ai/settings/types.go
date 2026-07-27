package settings

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

const (
	CurrentSchemaVersion        = 1
	CurrentProfileSchemaVersion = 1
	MinTimeoutMS                = 100
	MaxTimeoutMS                = 300_000
	MinInputChars               = 1
	MaxInputChars               = 2_000_000
	MinHistoryChars             = 0
	MaxHistoryChars             = 1_000_000
	MinEvidenceChars            = 0
	MaxEvidenceChars            = 2_000_000
	MinOutputTokens             = 1
	MaxOutputTokens             = 100_000
	MaxProfileIDBytes           = 64
	MaxLabelBytes               = 100
	MaxModelBytes               = 200
	MaxBaseURLBytes             = 4_096
	MaxCredentialRefBytes       = 1_024
	MaxEmbeddingDimensions      = 4_096
)

type ProfileRole string

const (
	RoleChat      ProfileRole = "chat"
	RoleEmbedding ProfileRole = "embedding"
)

type ProviderKind string

const (
	ProviderOpenAI           ProviderKind = "openai"
	ProviderAnthropic        ProviderKind = "anthropic"
	ProviderGemini           ProviderKind = "gemini"
	ProviderOpenAICompatible ProviderKind = "openai-compatible"
	ProviderOllama           ProviderKind = "ollama"
)

type Profile struct {
	SchemaVersion    int          `json:"schemaVersion"`
	ID               string       `json:"id"`
	Role             ProfileRole  `json:"role"`
	Kind             ProviderKind `json:"kind"`
	Label            string       `json:"label"`
	Model            string       `json:"model"`
	BaseURL          string       `json:"baseUrl"`
	CredentialRef    string       `json:"credentialRef,omitempty"`
	TimeoutMS        int          `json:"timeoutMs"`
	MaxInputChars    int          `json:"maxInputChars"`
	MaxHistoryChars  int          `json:"maxHistoryChars"`
	MaxEvidenceChars int          `json:"maxEvidenceChars"`
	MaxOutputTokens  int          `json:"maxOutputTokens"`
	Dimensions       int          `json:"dimensions,omitempty"`
}

type Config struct {
	// Fixed role slots cap the aggregate profile count at two.
	SchemaVersion     int                     `json:"schemaVersion"`
	Chat              *Profile                `json:"chat,omitempty"`
	Embedding         *Profile                `json:"embedding,omitempty"`
	EmbeddingConsents []EmbeddingConsentGrant `json:"embeddingConsents,omitempty"`
}

func DefaultConfig() Config { return Config{SchemaVersion: CurrentSchemaVersion} }

func (c Config) Validate() error {
	_, err := c.Normalized()
	return err
}

func (c Config) Normalized() (Config, error) {
	if c.SchemaVersion != CurrentSchemaVersion {
		return Config{}, fmt.Errorf("unsupported config schema version %d", c.SchemaVersion)
	}
	result := Config{SchemaVersion: c.SchemaVersion}
	var err error
	if result.Chat, err = normalizeSlot(c.Chat, RoleChat); err != nil {
		return Config{}, err
	}
	if result.Embedding, err = normalizeSlot(c.Embedding, RoleEmbedding); err != nil {
		return Config{}, err
	}
	if result.EmbeddingConsents, err = normalizeEmbeddingConsents(c.EmbeddingConsents); err != nil {
		return Config{}, err
	}
	return result, nil
}

func normalizeSlot(source *Profile, role ProfileRole) (*Profile, error) {
	if source == nil {
		return nil, nil
	}
	profile, err := source.Normalized()
	if err != nil {
		return nil, err
	}
	if profile.Role != role {
		return nil, fmt.Errorf("%s profile has role %q", role, profile.Role)
	}
	return &profile, nil
}

var profileIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

func (p Profile) Normalized() (Profile, error) {
	if p.SchemaVersion != CurrentProfileSchemaVersion {
		return Profile{}, fmt.Errorf("unsupported profile schema version %d", p.SchemaVersion)
	}
	if len(p.ID) > MaxProfileIDBytes || !profileIDPattern.MatchString(p.ID) {
		return Profile{}, errors.New("profile ID must be 1-64 safe characters")
	}
	p.Label = strings.TrimSpace(p.Label)
	p.Model = strings.TrimSpace(p.Model)
	if err := validateText("label", p.Label, MaxLabelBytes); err != nil {
		return Profile{}, err
	}
	if err := validateText("model", p.Model, MaxModelBytes); err != nil {
		return Profile{}, err
	}
	if len(p.BaseURL) > MaxBaseURLBytes {
		return Profile{}, fmt.Errorf("base URL must be at most %d bytes", MaxBaseURLBytes)
	}
	if len(p.CredentialRef) > MaxCredentialRefBytes || strings.IndexFunc(p.CredentialRef, unicode.IsControl) >= 0 {
		return Profile{}, fmt.Errorf("credential reference must be control-free and at most %d bytes", MaxCredentialRefBytes)
	}
	if err := validateCompatibility(p.Role, p.Kind); err != nil {
		return Profile{}, err
	}
	if p.Role == RoleChat && p.Dimensions != 0 || p.Role == RoleEmbedding && (p.Dimensions < 0 || p.Dimensions > MaxEmbeddingDimensions) {
		return Profile{}, fmt.Errorf("dimensions must be zero for chat or between 0 and %d for embeddings", MaxEmbeddingDimensions)
	}
	baseURL, err := normalizeBaseURL(p.BaseURL)
	if err != nil {
		return Profile{}, err
	}
	p.BaseURL = baseURL
	for _, budget := range []struct {
		name            string
		value, min, max int
	}{
		{"timeoutMs", p.TimeoutMS, MinTimeoutMS, MaxTimeoutMS},
		{"maxInputChars", p.MaxInputChars, MinInputChars, MaxInputChars},
		{"maxHistoryChars", p.MaxHistoryChars, MinHistoryChars, MaxHistoryChars},
		{"maxEvidenceChars", p.MaxEvidenceChars, MinEvidenceChars, MaxEvidenceChars},
		{"maxOutputTokens", p.MaxOutputTokens, MinOutputTokens, MaxOutputTokens},
	} {
		if budget.value < budget.min || budget.value > budget.max {
			return Profile{}, fmt.Errorf("%s must be between %d and %d", budget.name, budget.min, budget.max)
		}
	}
	return p, nil
}

func (p Profile) Fingerprint() (string, error) {
	p, err := p.Normalized()
	if err != nil {
		return "", err
	}
	// CredentialRef, ID, and label do not affect provider semantics.
	effective := []any{p.Role, p.Kind, p.Model, p.BaseURL, p.TimeoutMS, p.MaxInputChars, p.MaxHistoryChars, p.MaxEvidenceChars, p.MaxOutputTokens, p.Dimensions}
	raw, _ := json.Marshal(effective)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func validateCompatibility(role ProfileRole, kind ProviderKind) error {
	chat := kind == ProviderOpenAI || kind == ProviderAnthropic || kind == ProviderGemini || kind == ProviderOpenAICompatible || kind == ProviderOllama
	if role == RoleChat && chat {
		return nil
	}
	embedding := kind == ProviderOpenAI || kind == ProviderGemini || kind == ProviderOpenAICompatible || kind == ProviderOllama
	if role == RoleEmbedding && embedding {
		return nil
	}
	return fmt.Errorf("provider %q is not supported for role %q", kind, role)
}

func validateText(name, value string, max int) error {
	if value == "" || len(value) > max || strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return fmt.Errorf("%s must be non-empty, control-free, and at most %d bytes", name, max)
	}
	return nil
}
