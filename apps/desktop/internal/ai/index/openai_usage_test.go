package index

import (
	"context"
	"net/http"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func TestOpenAIUsageMapsAndAbsentMeansZero(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	for name, body := range map[string]string{
		"positive": `{"data":[{"index":0,"embedding":[1,2,3]}],"usage":{"prompt_tokens":7,"total_tokens":7}}`,
		"absent":   `{"data":[{"index":0,"embedding":[1,2,3]}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			options := grantedOptions(t, profile, func(*http.Request) *http.Response { return jsonResponse(200, body) })
			provider, _ := NewEmbeddingProvider(profile, options)
			batch, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"x"}})
			if err != nil {
				t.Fatal(err)
			}
			want := 0
			if name == "positive" {
				want = 7
			}
			if batch.Usage.InputTokens != want {
				t.Fatalf("usage %#v", batch.Usage)
			}
		})
	}
}

func TestOpenAIUsageOverflowRejected(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAICompatible, "https://api.example.com/v1")
	body := `{"data":[{"index":0,"embedding":[1,2,3]}],"usage":{"prompt_tokens":1000000001,"total_tokens":1000000001}}`
	options := grantedOptions(t, profile, func(*http.Request) *http.Response { return jsonResponse(200, body) })
	provider, _ := NewEmbeddingProvider(profile, options)
	if _, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"x"}}); err == nil {
		t.Fatal("overflow usage accepted")
	}
}
