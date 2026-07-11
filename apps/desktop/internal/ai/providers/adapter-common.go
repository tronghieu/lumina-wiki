package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type credentialResolver interface {
	Get(context.Context, string) ([]byte, error)
}

type adapterConfig struct {
	profile settings.Profile
	client  SafeClient
	secrets credentialResolver
	now     func() time.Time
}

func NewProvider(profile settings.Profile, client SafeClient, secrets credentialResolver) (ChatProvider, error) {
	return NewProviderWithRetryOptions(profile, client, secrets, RetryOptions{})
}

func NewProviderWithRetryOptions(profile settings.Profile, client SafeClient, secrets credentialResolver, retryOptions RetryOptions) (ChatProvider, error) {
	normalized, err := profile.Normalized()
	if err != nil || normalized.Role != settings.RoleChat {
		return nil, NewSafeError("invalid_profile", "The provider profile is invalid.", nil)
	}
	u, err := url.Parse(normalized.BaseURL)
	if err != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, NewSafeError("invalid_profile", "The provider profile is invalid.", nil)
	}
	if retryOptions.Timeout <= 0 {
		retryOptions.Timeout = time.Duration(normalized.TimeoutMS) * time.Millisecond
	}
	retryOptions = normalizeRetryOptions(retryOptions)
	config := adapterConfig{profile: normalized, client: client, secrets: secrets, now: retryOptions.Clock}
	var provider ChatProvider
	switch normalized.Kind {
	case settings.ProviderOpenAI:
		if normalized.CredentialRef == "" || secrets == nil {
			return nil, NewSafeError("invalid_profile", "The provider profile is invalid.", nil)
		}
		provider = &openAIAdapter{config: config}
	case settings.ProviderAnthropic:
		if normalized.CredentialRef == "" || secrets == nil {
			return nil, NewSafeError("invalid_profile", "The provider profile is invalid.", nil)
		}
		provider = &anthropicAdapter{config: config}
	case settings.ProviderGemini:
		if normalized.CredentialRef == "" || secrets == nil {
			return nil, NewSafeError("invalid_profile", "The provider profile is invalid.", nil)
		}
		provider = &geminiAdapter{config: config}
	case settings.ProviderOpenAICompatible, settings.ProviderOllama:
		if normalized.CredentialRef != "" && secrets == nil {
			return nil, NewSafeError("invalid_profile", "The provider profile is invalid.", nil)
		}
		provider = &compatibleAdapter{config: config}
	default:
		return nil, NewSafeError("unsupported_provider", "The provider is not supported.", nil)
	}
	return NewRetryingProvider(provider, retryOptions), nil
}

func (c adapterConfig) streamContext(parent context.Context) (context.Context, context.CancelFunc, error) {
	if parent == nil {
		return nil, func() {}, NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	if err := parent.Err(); err != nil {
		return nil, func() {}, err
	}
	ctx, cancel := context.WithTimeout(parent, time.Duration(c.profile.TimeoutMS)*time.Millisecond)
	return ctx, cancel, nil
}

func (c adapterConfig) endpoint(suffix string) (string, error) {
	u, err := url.Parse(c.profile.BaseURL)
	if err != nil || !strings.HasPrefix(suffix, "/") || strings.Contains(suffix, "..") || strings.ContainsAny(suffix, "?#") {
		return "", NewSafeError("invalid_profile", "The provider profile is invalid.", nil)
	}
	decoded := strings.TrimRight(u.Path, "/") + suffix
	escaped := strings.TrimRight(u.EscapedPath(), "/") + suffix
	u.Path, u.RawPath = decoded, escaped
	return u.String(), nil
}

func (c adapterConfig) validateRequest(request ProviderRequest) error {
	if err := request.Validate(); err != nil {
		return err
	}
	if request.Model != c.profile.Model || request.MaxOutputTokens > c.profile.MaxOutputTokens {
		return NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	last := utf8.RuneCountInString(request.Turns[len(request.Turns)-1].Content)
	history := 0
	for _, turn := range request.Turns[:len(request.Turns)-1] {
		if !addWithin(&history, utf8.RuneCountInString(turn.Content), c.profile.MaxHistoryChars) {
			return NewSafeError("invalid_request", "The provider request exceeds the profile input budget.", nil)
		}
	}
	if last > c.profile.MaxInputChars || utf8.RuneCountInString(request.System) > c.profile.MaxEvidenceChars {
		return NewSafeError("invalid_request", "The provider request exceeds the profile input budget.", nil)
	}
	return nil
}

func (c adapterConfig) request(ctx context.Context, endpoint string, body any, headerName, prefix string, optional bool) (*http.Request, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, NewSafeError("request_encode", "The provider request could not be encoded.", nil)
	}
	var secret []byte
	if c.profile.CredentialRef != "" {
		if c.secrets == nil {
			return nil, NewSafeError("credential_unavailable", "The provider credential is unavailable.", nil)
		}
		secret, err = c.secrets.Get(ctx, c.profile.CredentialRef)
		if err != nil {
			return nil, safeFailure("credential_unavailable", "The provider credential is unavailable.", err)
		}
	}
	defer zeroSecret(secret)
	if len(secret) == 0 && !optional {
		return nil, NewSafeError("credential_unavailable", "The provider credential is unavailable.", nil)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if len(secret) > 0 {
		req.Header.Set(headerName, prefix+string(secret))
	}
	return req, nil
}

func zeroSecret(secret []byte) {
	for i := range secret {
		secret[i] = 0
	}
}
