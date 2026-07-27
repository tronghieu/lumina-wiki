package index

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type delayedBody struct {
	data  *strings.Reader
	delay time.Duration
}

func (body *delayedBody) Read(target []byte) (int, error) {
	time.Sleep(body.delay)
	body.delay = 0
	return body.data.Read(target)
}

func (*delayedBody) Close() error { return nil }

func TestConsentPrecedesCredentialResolverAndTransport(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	secret, resolver, trips := &credentialSpy{secret: []byte("secret")}, &resolverSpy{}, 0
	provider, err := NewEmbeddingProvider(profile, FactoryOptions{WorkspaceID: testWorkspace, Config: settings.DefaultConfig(), Credentials: secret,
		Client: providers.SafeClient{Policy: providers.EndpointPolicy{Resolver: resolver}, NewRoundTripper: func(providers.ApprovedEndpoint) http.RoundTripper {
			trips++
			return roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("must not send") })
		}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"private text"}})
	if !errors.Is(err, ErrConsentRequired) || secret.calls != 0 || resolver.calls != 0 || trips != 0 {
		t.Fatalf("err=%v secret=%d resolver=%d trips=%d", err, secret.calls, resolver.calls, trips)
	}
}

func TestEmbeddingRequestRejectsInvalidInputBeforeOutbound(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	calls := 0
	options := grantedOptions(t, profile, func(*http.Request) *http.Response { calls++; return jsonResponse(200, `{}`) })
	provider, _ := NewEmbeddingProvider(profile, options)
	for name, request := range map[string]EmbeddingRequest{
		"purpose":      {Purpose: EmbeddingPurpose("other"), Inputs: []string{"x"}},
		"empty":        {Purpose: PurposeDocument},
		"blank":        {Purpose: PurposeDocument, Inputs: []string{""}},
		"invalid utf8": {Purpose: PurposeDocument, Inputs: []string{string([]byte{0xff})}},
		"control":      {Purpose: PurposeDocument, Inputs: []string{"secret\x00text"}},
		"batch":        {Purpose: PurposeDocument, Inputs: make([]string, MaxEmbeddingBatch+1)},
		"bytes":        {Purpose: PurposeDocument, Inputs: []string{strings.Repeat("a", MaxEmbeddingInputBytes+1)}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := provider.Embed(context.Background(), request); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
	if calls != 0 {
		t.Fatalf("sent %d invalid requests", calls)
	}
}

func TestEmbeddingResponseValidationAndRedaction(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	secret := "private-input-or-key"
	responses := map[string]string{
		"duplicate": `{"data":[{"index":0,"embedding":[1,2,3]},{"index":0,"embedding":[1,2,3]}]}`,
		"missing":   `{"data":[]}`,
		"dimension": `{"data":[{"index":0,"embedding":[1,2]}]}`,
		"nonfinite": `{"data":[{"index":0,"embedding":[1e400,2,3]}]}`,
		"model":     `{"model":"wrong","data":[{"index":0,"embedding":[1,2,3]}]}`,
		"unknown":   `{"secret":"private-input-or-key","data":[{"index":0,"embedding":[1,2,3]}]}`,
	}
	for name, body := range responses {
		t.Run(name, func(t *testing.T) {
			options := grantedOptions(t, profile, func(*http.Request) *http.Response { return jsonResponse(200, body) })
			provider, _ := NewEmbeddingProvider(profile, options)
			_, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{secret}})
			if err == nil || strings.Contains(err.Error(), secret) {
				t.Fatalf("unsafe error %v", err)
			}
		})
	}
}

func TestProviderDefaultDimensionsAndContext(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAICompatible, "https://api.example.com/v1")
	profile.Dimensions = 0
	options := grantedOptions(t, profile, func(*http.Request) *http.Response {
		return jsonResponse(200, `{"data":[{"index":0,"embedding":[1,2]},{"index":1,"embedding":[3,4]}]}`)
	})
	provider, _ := NewEmbeddingProvider(profile, options)
	batch, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"a", "b"}})
	if err != nil || batch.Dimensions != 2 || math.IsNaN(float64(batch.Vectors[0][0])) {
		t.Fatalf("batch %#v %v", batch, err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := provider.Embed(canceled, EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"a"}}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	deadline, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	time.Sleep(time.Millisecond)
	if _, err := provider.Embed(deadline, EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"a"}}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline: %v", err)
	}
}

func TestEmbeddingDeadlineCoversResponseDecode(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	options := grantedOptions(t, profile, func(*http.Request) *http.Response {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: &delayedBody{data: strings.NewReader(`{"data":[{"index":0,"embedding":[1,2,3]}]}`), delay: 10 * time.Millisecond}}
	})
	provider, _ := NewEmbeddingProvider(profile, options)
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if _, err := provider.Embed(ctx, EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"x"}}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("decode outlived deadline: %v", err)
	}
}
