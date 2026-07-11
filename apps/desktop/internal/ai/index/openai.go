package index

import (
	"context"
	"math"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
)

type openAIEmbeddingRequest struct {
	Input          []string `json:"input"`
	Model          string   `json:"model"`
	Dimensions     int      `json:"dimensions,omitempty"`
	EncodingFormat string   `json:"encoding_format"`
}

type openAIEmbeddingResponse struct {
	Object string `json:"object,omitempty"`
	Model  string `json:"model,omitempty"`
	Data   []struct {
		Object    string    `json:"object,omitempty"`
		Index     int       `json:"index"`
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
	Usage *struct {
		PromptTokens int `json:"prompt_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage,omitempty"`
}

func (adapter *embeddingAdapter) embedOpenAI(ctx context.Context, request EmbeddingRequest) (EmbeddingBatch, error) {
	required := adapter.profile.Kind == settings.ProviderOpenAI
	response, err := adapter.post(ctx, openAIEmbeddingRequest{Input: request.Inputs, Model: adapter.profile.Model, Dimensions: adapter.profile.Dimensions, EncodingFormat: "float"}, "Authorization", "Bearer ", required)
	if err != nil {
		return EmbeddingBatch{}, err
	}
	defer response.Body.Close()
	var payload openAIEmbeddingResponse
	if err := decodeJSON(ctx, response.Body, &payload); err != nil {
		return EmbeddingBatch{}, err
	}
	if payload.Model != "" && payload.Model != adapter.profile.Model || len(payload.Data) != len(request.Inputs) {
		return EmbeddingBatch{}, malformedResponse()
	}
	if payload.Usage != nil && (payload.Usage.PromptTokens < 0 || payload.Usage.TotalTokens < payload.Usage.PromptTokens || payload.Usage.TotalTokens > 1_000_000_000) {
		return EmbeddingBatch{}, malformedResponse()
	}
	usage := EmbeddingUsage{}
	if payload.Usage != nil {
		usage.InputTokens = payload.Usage.PromptTokens
	}
	vectors := make([][]float32, len(request.Inputs))
	dimensions := adapter.profile.Dimensions
	seen := make([]bool, len(vectors))
	for _, item := range payload.Data {
		if item.Index < 0 || item.Index >= len(vectors) || seen[item.Index] {
			return EmbeddingBatch{}, malformedResponse()
		}
		if dimensions == 0 {
			dimensions = len(item.Embedding)
		}
		vector, ok := checkedVector(item.Embedding, dimensions)
		if !ok {
			return EmbeddingBatch{}, malformedResponse()
		}
		seen[item.Index], vectors[item.Index] = true, vector
	}
	if dimensions < 1 || dimensions > settings.MaxEmbeddingDimensions {
		return EmbeddingBatch{}, malformedResponse()
	}
	return EmbeddingBatch{Model: adapter.profile.Model, Dimensions: dimensions, Vectors: vectors, Usage: usage}, nil
}

func checkedVector(values []float64, dimensions int) ([]float32, bool) {
	if dimensions < 1 || dimensions > settings.MaxEmbeddingDimensions || len(values) != dimensions {
		return nil, false
	}
	vector := make([]float32, dimensions)
	for i, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > math.MaxFloat32 {
			return nil, false
		}
		vector[i] = float32(value)
	}
	return vector, true
}
