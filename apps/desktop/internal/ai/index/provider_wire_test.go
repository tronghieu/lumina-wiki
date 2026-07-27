package index

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type credentialSpy struct {
	calls  int
	secret []byte
}

func (s *credentialSpy) Get(ctx context.Context, _ string) ([]byte, error) {
	s.calls++
	return append([]byte(nil), s.secret...), ctx.Err()
}

type resolverSpy struct{ calls int }

func (s *resolverSpy) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	s.calls++
	return []net.IPAddr{{IP: net.ParseIP("93.184.216.34").To4()}}, nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
}

func grantedOptions(t *testing.T, profile settings.Profile, check func(*http.Request) *http.Response) FactoryOptions {
	t.Helper()
	now := time.Date(2026, 7, 12, 1, 0, 0, 0, time.UTC)
	config, err := GrantConsent(settings.DefaultConfig(), testWorkspace, profile, now, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	return FactoryOptions{WorkspaceID: testWorkspace, Config: config, Now: func() time.Time { return now },
		Client: providers.SafeClient{Policy: providers.EndpointPolicy{Resolver: &resolverSpy{}}, CredentialHeaders: []string{"X-Goog-Api-Key"}, NewRoundTripper: func(providers.ApprovedEndpoint) http.RoundTripper {
			return roundTripFunc(func(request *http.Request) (*http.Response, error) { return check(request), nil })
		}}, Credentials: &credentialSpy{secret: []byte("top-secret")}}
}

func TestOpenAIEmbeddingWireAndOrdering(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOpenAI, "https://api.example.com/v1")
	options := grantedOptions(t, profile, func(r *http.Request) *http.Response {
		if r.Method != http.MethodPost || r.URL.EscapedPath() != "/v1/embeddings" || r.URL.RawQuery != "" {
			t.Fatalf("target %s %s", r.Method, r.URL)
		}
		if r.Header.Get("Authorization") != "Bearer top-secret" || r.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("headers %#v", r.Header)
		}
		var body struct {
			Input      []string `json:"input"`
			Model      string   `json:"model"`
			Dimensions int      `json:"dimensions"`
			Encoding   string   `json:"encoding_format"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Input) != 2 || body.Model != profile.Model || body.Dimensions != 3 || body.Encoding != "float" {
			t.Fatalf("body %#v %v", body, err)
		}
		return jsonResponse(200, `{"object":"list","model":"embed-model","data":[{"object":"embedding","index":1,"embedding":[4,5,6]},{"object":"embedding","index":0,"embedding":[1,2,3]}],"usage":{"prompt_tokens":2,"total_tokens":2}}`)
	})
	provider, err := NewEmbeddingProvider(profile, options)
	if err != nil {
		t.Fatal(err)
	}
	batch, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"first", "second"}})
	if err != nil || batch.Dimensions != 3 || len(batch.Vectors) != 2 || batch.Vectors[0][0] != 1 || batch.Vectors[1][0] != 4 {
		t.Fatalf("batch %#v %v", batch, err)
	}
}

func TestGeminiEmbeddingWirePurposeAndModelTwoPrefix(t *testing.T) {
	for _, tc := range []struct{ model, wantTask, wantText string }{
		{"gemini-embedding-001", "RETRIEVAL_QUERY", "hello"},
		{"gemini-embedding-2", "", "task: search result | query: hello"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			profile := embeddingProfile(settings.ProviderGemini, "https://generativelanguage.googleapis.com/v1beta")
			profile.Model = tc.model
			options := grantedOptions(t, profile, func(r *http.Request) *http.Response {
				if r.URL.EscapedPath() != "/v1beta/models/"+tc.model+":batchEmbedContents" || r.Header.Get("X-Goog-Api-Key") != "top-secret" || r.URL.RawQuery != "" {
					t.Fatalf("request %s %#v", r.URL, r.Header)
				}
				var body struct {
					Requests []struct {
						Model, TaskType      string
						OutputDimensionality int
						Content              struct{ Parts []struct{ Text string } }
					}
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Requests) != 1 || body.Requests[0].Model != "models/"+tc.model || body.Requests[0].TaskType != tc.wantTask || body.Requests[0].Content.Parts[0].Text != tc.wantText || body.Requests[0].OutputDimensionality != 3 {
					t.Fatalf("body %#v %v", body, err)
				}
				return jsonResponse(200, `{"embeddings":[{"values":[1,2,3]}]}`)
			})
			provider, err := NewEmbeddingProvider(profile, options)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeQuery, Inputs: []string{"hello"}}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestGeminiEmbeddingTwoDocumentPrefixIsByteExact(t *testing.T) {
	profile := embeddingProfile(settings.ProviderGemini, "https://generativelanguage.googleapis.com/v1beta")
	profile.Model = "gemini-embedding-2"
	options := grantedOptions(t, profile, func(r *http.Request) *http.Response {
		var body struct {
			Requests []struct {
				TaskType string `json:"taskType"`
				Content  struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"requests"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Requests) != 1 || body.Requests[0].TaskType != "" || body.Requests[0].Content.Parts[0].Text != "title: none | text: body\nbytes" {
			t.Fatalf("model-2 document wire: %#v %v", body, err)
		}
		return jsonResponse(200, `{"embeddings":[{"values":[1,2,3]}]}`)
	})
	provider, _ := NewEmbeddingProvider(profile, options)
	if _, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"body\nbytes"}}); err != nil {
		t.Fatal(err)
	}
}

func TestGeminiUsageMetadataMapsAndIsOptional(t *testing.T) {
	profile := embeddingProfile(settings.ProviderGemini, "https://generativelanguage.googleapis.com/v1beta")
	for name, body := range map[string]string{
		"present": `{"embeddings":[{"values":[1,2,3]}],"usageMetadata":{"promptTokenCount":3,"promptTokenDetails":[{"modality":"TEXT","tokenCount":3}]}}`,
		"absent":  `{"embeddings":[{"values":[1,2,3]}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			options := grantedOptions(t, profile, func(*http.Request) *http.Response { return jsonResponse(200, body) })
			provider, _ := NewEmbeddingProvider(profile, options)
			batch, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeQuery, Inputs: []string{"hello"}})
			if err != nil {
				t.Fatal(err)
			}
			want := 0
			if name == "present" {
				want = 3
			}
			if batch.Usage.InputTokens != want {
				t.Fatalf("usage %#v", batch.Usage)
			}
		})
	}
}

func TestCompatibleOptionalAuthorization(t *testing.T) {
	profile := embeddingProfile(settings.ProviderOllama, "http://127.0.0.1:11434/v1")
	profile.CredentialRef = ""
	options := grantedOptions(t, profile, func(r *http.Request) *http.Response {
		if r.Header.Get("Authorization") != "" {
			t.Fatal("invented authorization")
		}
		return jsonResponse(200, `{"data":[{"index":0,"embedding":[1,2,3]}]}`)
	})
	options.Credentials = nil
	provider, err := NewEmbeddingProvider(profile, options)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Embed(context.Background(), EmbeddingRequest{Purpose: PurposeDocument, Inputs: []string{"hello"}}); err != nil {
		t.Fatal(err)
	}
}
