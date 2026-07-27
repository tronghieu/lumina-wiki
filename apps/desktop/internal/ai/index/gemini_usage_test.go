package index

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

func TestGeminiUsageMetadataRejectsMalformedValues(t *testing.T) {
	profile := embeddingProfile(settings.ProviderGemini, "https://generativelanguage.googleapis.com/v1beta")
	tooMany := strings.Repeat(`{"modality":"TEXT","tokenCount":0},`, MaxGeminiTokenDetails) + `{"modality":"TEXT","tokenCount":0}`
	for name, metadata := range map[string]string{
		"negative total":   `{"promptTokenCount":-1}`,
		"overflow total":   `{"promptTokenCount":1000000001}`,
		"negative detail":  `{"promptTokenCount":0,"promptTokenDetails":[{"modality":"TEXT","tokenCount":-1}]}`,
		"unknown modality": `{"promptTokenCount":1,"promptTokenDetails":[{"modality":"PRIVATE_KEY","tokenCount":1}]}`,
		"inconsistent":     `{"promptTokenCount":2,"promptTokenDetails":[{"modality":"TEXT","tokenCount":1}]}`,
		"too many details": `{"promptTokenCount":0,"promptTokenDetails":[` + tooMany + `]}`,
		"unknown nested":   `{"promptTokenCount":1,"promptTokenDetails":[{"modality":"TEXT","tokenCount":1,"secret":"x"}]}`,
		"duplicate nested": `{"promptTokenCount":1,"promptTokenDetails":[{"modality":"TEXT","MODALITY":"TEXT","tokenCount":1}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			body := `{"embeddings":[{"values":[1,2,3]}],"usageMetadata":` + metadata + `}`
			options := grantedOptions(t, profile, func(*http.Request) *http.Response { return jsonResponse(200, body) })
			provider, _ := NewEmbeddingProvider(profile, options)
			if _, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeQuery, Inputs: []string{"hello"}}); err == nil {
				t.Fatal("invalid usage accepted")
			}
		})
	}
}
