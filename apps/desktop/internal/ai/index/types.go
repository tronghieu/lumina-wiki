package index

import (
	"context"
	"unicode"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
)

const (
	MaxEmbeddingBatch         = 128
	MaxEmbeddingInputBytes    = 1 << 20
	MaxEmbeddingInputRunes    = 250_000
	MaxEmbeddingTotalBytes    = 8 << 20
	MaxEmbeddingRequestBytes  = 10 << 20
	MaxEmbeddingResponseBytes = 16 << 20
)

type EmbeddingPurpose string

const (
	PurposeDocument EmbeddingPurpose = "document"
	PurposeQuery    EmbeddingPurpose = "query"
)

type EmbeddingRequest struct {
	Purpose EmbeddingPurpose
	Inputs  []string
}

type EmbeddingBatch struct {
	Model      string
	Dimensions int
	Vectors    [][]float32
	Usage      EmbeddingUsage
}

type EmbeddingUsage struct{ InputTokens int }

type EmbeddingProvider interface {
	Embed(context.Context, EmbeddingRequest) (EmbeddingBatch, error)
}

func (request EmbeddingRequest) validate(maxRunes int) error {
	if request.Purpose != PurposeDocument && request.Purpose != PurposeQuery || len(request.Inputs) == 0 || len(request.Inputs) > MaxEmbeddingBatch {
		return invalidRequest()
	}
	total := 0
	for _, input := range request.Inputs {
		runes := utf8.RuneCountInString(input)
		if input == "" || !utf8.ValidString(input) || len(input) > MaxEmbeddingInputBytes || runes > MaxEmbeddingInputRunes || runes > maxRunes || total > MaxEmbeddingTotalBytes-len(input) {
			return invalidRequest()
		}
		for _, r := range input {
			if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
				return invalidRequest()
			}
		}
		total += len(input)
	}
	return nil
}

func invalidRequest() error {
	return providers.NewSafeError("invalid_embedding_request", "The embedding request is invalid.", nil)
}

func malformedResponse() error {
	return providers.NewSafeError("malformed_embedding_response", "The embedding response was invalid.", nil)
}
