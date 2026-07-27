package index

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

type CredentialResolver interface {
	Get(context.Context, string) ([]byte, error)
}

type FactoryOptions struct {
	WorkspaceID workspaceid.WorkspaceID
	Config      settings.Config
	Client      providers.SafeClient
	Credentials CredentialResolver
	Now         func() time.Time
}

type embeddingAdapter struct {
	profile  settings.Profile
	options  FactoryOptions
	endpoint string
}

func NewEmbeddingProvider(profile settings.Profile, options FactoryOptions) (EmbeddingProvider, error) {
	normalized, err := profile.Normalized()
	if err != nil || normalized != profile || profile.Role != settings.RoleEmbedding || !options.WorkspaceID.Valid() {
		return nil, providers.NewSafeError("invalid_embedding_profile", "The embedding profile is invalid.", nil)
	}
	normalizedConfig, err := options.Config.Normalized()
	if err != nil {
		return nil, providers.NewSafeError("invalid_embedding_config", "The embedding consent configuration is invalid.", nil)
	}
	options.Config = normalizedConfig
	if (profile.Kind == settings.ProviderOpenAI || profile.Kind == settings.ProviderGemini) && (profile.CredentialRef == "" || options.Credentials == nil) || profile.CredentialRef != "" && options.Credentials == nil {
		return nil, providers.NewSafeError("invalid_embedding_profile", "The embedding profile is invalid.", nil)
	}
	suffix := "/embeddings"
	if profile.Kind == settings.ProviderGemini {
		if !regexp.MustCompile(`^[A-Za-z0-9._-]{1,200}$`).MatchString(profile.Model) {
			return nil, providers.NewSafeError("invalid_embedding_profile", "The embedding profile is invalid.", nil)
		}
		suffix = "/models/" + profile.Model + ":batchEmbedContents"
	}
	endpoint, err := appendEndpoint(profile.BaseURL, suffix)
	if err != nil {
		return nil, providers.NewSafeError("invalid_embedding_profile", "The embedding profile is invalid.", nil)
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.Client.Options.MaxResponseBytes <= 0 || options.Client.Options.MaxResponseBytes > MaxEmbeddingResponseBytes {
		options.Client.Options.MaxResponseBytes = MaxEmbeddingResponseBytes
	}
	return &embeddingAdapter{profile: profile, options: options, endpoint: endpoint}, nil
}

func appendEndpoint(base, suffix string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return "", errors.New("invalid endpoint")
	}
	u.Path = trimSlash(u.Path) + suffix
	u.RawPath = trimSlash(u.EscapedPath()) + suffix
	return u.String(), nil
}

func trimSlash(value string) string {
	for len(value) > 0 && value[len(value)-1] == '/' {
		value = value[:len(value)-1]
	}
	return value
}

func (adapter *embeddingAdapter) Embed(parent context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	if parent == nil {
		return EmbeddingBatch{}, invalidRequest()
	}
	ctx, cancel := context.WithTimeout(parent, time.Duration(adapter.profile.TimeoutMS)*time.Millisecond)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return EmbeddingBatch{}, err
	}
	if err := request.validate(adapter.profile.MaxInputChars); err != nil {
		return EmbeddingBatch{}, err
	}
	if err := RequireConsent(adapter.options.Config, adapter.options.WorkspaceID, adapter.profile, adapter.options.Now()); err != nil {
		return EmbeddingBatch{}, err
	}
	if adapter.profile.Kind == settings.ProviderGemini {
		return adapter.embedGemini(ctx, request)
	}
	return adapter.embedOpenAI(ctx, request)
}
