package index

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type leakingErrorResolver struct{ secret []byte }

func (r *leakingErrorResolver) Get(context.Context, string) ([]byte, error) {
	return r.secret, errors.New("credential error contains private material")
}

type mappedResolver struct{ answers map[string]string }

func (r mappedResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: net.ParseIP(r.answers[host]).To4()}}, nil
}

func TestEmbeddingRejectsDuplicateJSONKeysAndInvalidUsage(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	for name, body := range map[string]string{
		"root duplicate":   `{"data":[{"index":0,"embedding":[1,2,3]}],"DATA":[]}`,
		"nested duplicate": `{"data":[{"index":0,"INDEX":0,"embedding":[1,2,3]}]}`,
		"negative usage":   `{"data":[{"index":0,"embedding":[1,2,3]}],"usage":{"prompt_tokens":-1,"total_tokens":-1}}`,
	} {
		t.Run(name, func(t *testing.T) {
			options := grantedOptions(t, profile, func(*http.Request) *http.Response { return jsonResponse(200, body) })
			provider, _ := NewEmbeddingProvider(profile, options)
			if _, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"x"}}); err == nil {
				t.Fatal("malformed response accepted")
			}
		})
	}
}

func TestEmbeddingResponseHardCap(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	options := grantedOptions(t, profile, func(*http.Request) *http.Response {
		return jsonResponse(200, strings.Repeat(" ", MaxEmbeddingResponseBytes+1))
	})
	options.Client.Options.MaxResponseBytes = MaxEmbeddingResponseBytes * 2
	provider, _ := NewEmbeddingProvider(profile, options)
	_, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"x"}})
	var safe *providers.SafeError
	if !errors.As(err, &safe) || safe.Code != "response_too_large" {
		t.Fatalf("cap error: %v", err)
	}
}

func TestEmbeddingCrossOriginRedirectStripsAuthorization(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	now := time.Date(2026, 7, 12, 1, 0, 0, 0, time.UTC)
	config, _ := GrantConsent(settings.DefaultConfig(), testWorkspace, profile, now, time.Time{})
	finalAuthorization := "not-called"
	client := providers.SafeClient{Policy: providers.EndpointPolicy{Resolver: mappedResolver{answers: map[string]string{"api.example.com": "93.184.216.34", "other.example": "1.1.1.1"}}}, NewRoundTripper: func(endpoint providers.ApprovedEndpoint) http.RoundTripper {
		return roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if endpoint.ServerName() == "api.example.com" {
				response := jsonResponse(http.StatusTemporaryRedirect, "redirect")
				response.Header.Set("Location", "https://other.example/final")
				return response, nil
			}
			finalAuthorization = request.Header.Get("Authorization")
			return jsonResponse(200, `{"data":[{"index":0,"embedding":[1,2,3]}]}`), nil
		})
	}}
	provider, err := NewEmbeddingProvider(profile, FactoryOptions{WorkspaceID: testWorkspace, Config: config, Client: client, Credentials: &credentialSpy{secret: []byte("secret")}, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"x"}}); err != nil {
		t.Fatal(err)
	}
	if finalAuthorization != "" {
		t.Fatal("authorization leaked across origin")
	}
}

func TestFactoryRejectsChatAndNonNormalizedProfiles(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	options := FactoryOptions{WorkspaceID: testWorkspace, Credentials: &credentialSpy{}}
	chat := profile
	chat.Role, chat.Dimensions = settings.RoleChat, 0
	if _, err := NewEmbeddingProvider(chat, options); err == nil {
		t.Fatal("chat profile accepted")
	}
	profile.BaseURL = "HTTPS://API.EXAMPLE.COM:443/v1/"
	if _, err := NewEmbeddingProvider(profile, options); err == nil {
		t.Fatal("non-normalized profile accepted")
	}
}

func TestFactorySnapshotsConsentAgainstCallerMutation(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	now := time.Date(2026, 7, 12, 1, 0, 0, 0, time.UTC)
	disclosure, _ := ConsentFingerprint(testWorkspace, profile)
	config := settings.DefaultConfig()
	config.EmbeddingConsents = []settings.EmbeddingConsentGrant{{WorkspaceID: string(testWorkspace), Fingerprint: strings.Repeat("a", 64), DisclosureVersion: CurrentDisclosureVersion, GrantedAt: now}}
	calls := 0
	options := FactoryOptions{WorkspaceID: testWorkspace, Config: config, Credentials: &credentialSpy{secret: []byte("secret")}, Now: func() time.Time { return now }, Client: providers.SafeClient{NewRoundTripper: func(providers.ApprovedEndpoint) http.RoundTripper {
		calls++
		return roundTripFunc(func(*http.Request) (*http.Response, error) { return jsonResponse(200, `{}`), nil })
	}}}
	provider, err := NewEmbeddingProvider(profile, options)
	if err != nil {
		t.Fatal(err)
	}
	config.EmbeddingConsents[0].Fingerprint = disclosure.Fingerprint
	_, err = provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"x"}})
	if !errors.Is(err, ErrConsentRequired) || calls != 0 {
		t.Fatalf("mutable consent affected provider: %v calls=%d", err, calls)
	}
}

func TestCredentialBytesWipedWhenResolverReturnsError(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	now := time.Date(2026, 7, 12, 1, 0, 0, 0, time.UTC)
	config, _ := GrantConsent(settings.DefaultConfig(), testWorkspace, profile, now, time.Time{})
	resolver := &leakingErrorResolver{secret: []byte("private")}
	provider, err := NewEmbeddingProvider(profile, FactoryOptions{WorkspaceID: testWorkspace, Config: config, Credentials: resolver, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"x"}})
	if err == nil || string(resolver.secret) != strings.Repeat("\x00", len(resolver.secret)) {
		t.Fatalf("credential not wiped: %v %q", err, resolver.secret)
	}
}

func TestFutureConsentGrantPreventsAllOutboundWork(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	grantedAt := time.Date(2026, 7, 12, 2, 0, 0, 0, time.UTC)
	config, _ := GrantConsent(settings.DefaultConfig(), testWorkspace, profile, grantedAt, time.Time{})
	secret, resolver, trips := &credentialSpy{secret: []byte("secret")}, &resolverSpy{}, 0
	provider, err := NewEmbeddingProvider(profile, FactoryOptions{WorkspaceID: testWorkspace, Config: config, Credentials: secret, Now: func() time.Time { return grantedAt.Add(-time.Second) }, Client: providers.SafeClient{Policy: providers.EndpointPolicy{Resolver: resolver}, NewRoundTripper: func(providers.ApprovedEndpoint) http.RoundTripper {
		trips++
		return roundTripFunc(func(*http.Request) (*http.Response, error) { return jsonResponse(200, `{}`), nil })
	}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"private"}})
	if !errors.Is(err, ErrConsentRequired) || secret.calls != 0 || resolver.calls != 0 || trips != 0 {
		t.Fatalf("future grant outbound: err=%v secret=%d dns=%d trips=%d", err, secret.calls, resolver.calls, trips)
	}
}
