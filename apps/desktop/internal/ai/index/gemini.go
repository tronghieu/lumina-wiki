package index

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

const MaxGeminiTokenDetails = 32

type geminiBatchRequest struct {
	Requests []geminiEmbedRequest `json:"requests"`
}

type geminiEmbedRequest struct {
	Model                string        `json:"model"`
	Content              geminiContent `json:"content"`
	TaskType             string        `json:"taskType,omitempty"`
	OutputDimensionality int           `json:"outputDimensionality,omitempty"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiBatchResponse struct {
	Embeddings []struct {
		Values []float64 `json:"values"`
	} `json:"embeddings"`
	UsageMetadata *geminiUsageMetadata `json:"usageMetadata,omitempty"`
}

type geminiUsageMetadata struct {
	PromptTokenCount   int                 `json:"promptTokenCount"`
	PromptTokenDetails []geminiTokenDetail `json:"promptTokenDetails,omitempty"`
}

type geminiTokenDetail struct {
	Modality   string `json:"modality"`
	TokenCount int    `json:"tokenCount"`
}

func (adapter *embeddingAdapter) embedGemini(ctx context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	requests := make([]geminiEmbedRequest, len(request.Inputs))
	for i, input := range request.Inputs {
		task := ""
		if adapter.profile.Model == "gemini-embedding-001" {
			if request.Purpose == PurposeDocument {
				task = "RETRIEVAL_DOCUMENT"
			} else {
				task = "RETRIEVAL_QUERY"
			}
		} else if adapter.profile.Model == "gemini-embedding-2" {
			if request.Purpose == PurposeDocument {
				input = "title: none | text: " + input
			} else {
				input = "task: search result | query: " + input
			}
		}
		requests[i] = geminiEmbedRequest{Model: "models/" + adapter.profile.Model, Content: geminiContent{Parts: []geminiPart{{Text: input}}}, TaskType: task, OutputDimensionality: adapter.profile.Dimensions}
	}
	response, err := adapter.post(ctx, geminiBatchRequest{Requests: requests}, "X-Goog-Api-Key", "", true)
	if err != nil {
		return EmbeddingBatch{}, err
	}
	defer response.Body.Close()
	var payload geminiBatchResponse
	if err := decodeJSON(ctx, response.Body, &payload); err != nil {
		return EmbeddingBatch{}, err
	}
	if len(payload.Embeddings) != len(request.Inputs) {
		return EmbeddingBatch{}, malformedResponse()
	}
	usage, ok := validateGeminiUsage(payload.UsageMetadata)
	if !ok {
		return EmbeddingBatch{}, malformedResponse()
	}
	dimensions := adapter.profile.Dimensions
	vectors := make([][]float32, len(payload.Embeddings))
	for i, item := range payload.Embeddings {
		if dimensions == 0 {
			dimensions = len(item.Values)
		}
		vector, ok := checkedVector(item.Values, dimensions)
		if !ok {
			return EmbeddingBatch{}, malformedResponse()
		}
		vectors[i] = vector
	}
	if dimensions < 1 || dimensions > settings.MaxEmbeddingDimensions {
		return EmbeddingBatch{}, malformedResponse()
	}
	return EmbeddingBatch{Model: adapter.profile.Model, Dimensions: dimensions, Vectors: vectors, Usage: usage}, nil
}

func validateGeminiUsage(metadata *geminiUsageMetadata) (EmbeddingUsage, bool) {
	if metadata == nil {
		return EmbeddingUsage{}, true
	}
	if metadata.PromptTokenCount < 0 || metadata.PromptTokenCount > 1_000_000_000 || len(metadata.PromptTokenDetails) > MaxGeminiTokenDetails {
		return EmbeddingUsage{}, false
	}
	total := 0
	for _, detail := range metadata.PromptTokenDetails {
		if !validGeminiModality(detail.Modality) || detail.TokenCount < 0 || total > 1_000_000_000-detail.TokenCount {
			return EmbeddingUsage{}, false
		}
		total += detail.TokenCount
	}
	if len(metadata.PromptTokenDetails) > 0 && total != metadata.PromptTokenCount {
		return EmbeddingUsage{}, false
	}
	return EmbeddingUsage{InputTokens: metadata.PromptTokenCount}, true
}

func validGeminiModality(value string) bool {
	switch value {
	case "MODALITY_UNSPECIFIED", "TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT":
		return true
	default:
		return false
	}
}
