package chat

import (
	"context"
	"math"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/index"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

type SemanticMetadata struct {
	Enabled            bool
	SnapshotHash       string
	ProfileFingerprint string
	ChunkerVersion     string
	ExpectedModel      string
	Dimensions         int
}

type HybridLimits struct {
	Limit         int
	SemanticLimit int
}

type HybridConfig struct {
	Lexical  *retrieval.Lexical
	Semantic SemanticSearcher
	Provider index.EmbeddingProvider
	Metadata SemanticMetadata
	Limits   HybridLimits
}

type SemanticSearcher interface {
	Search(context.Context, index.SemanticSearchRequest) ([]retrieval.SemanticHit, error)
}

type HybridResult struct {
	Hits           []retrieval.Hit          `json:"hits"`
	Warnings       []retrieval.Warning      `json:"warnings"`
	SemanticStatus retrieval.SemanticStatus `json:"semanticStatus"`
	WarningCode    string                   `json:"warningCode,omitempty"`
}

type HybridRetriever struct{ config HybridConfig }

func NewHybridRetriever(config HybridConfig) *HybridRetriever {
	return &HybridRetriever{config: config}
}

func (retriever *HybridRetriever) Lexical() *retrieval.Lexical {
	if retriever == nil {
		return nil
	}
	return retriever.config.Lexical
}

func (retriever *HybridRetriever) Retrieve(ctx context.Context, question string, options retrieval.SearchOptions) (HybridResult, error) {
	if err := ctx.Err(); err != nil {
		return HybridResult{}, err
	}
	if retriever == nil || retriever.config.Lexical == nil {
		return HybridResult{}, ErrInvalidRequest
	}
	limit := retriever.limit(options.Limit)
	options.Limit = limit
	baseline, err := retriever.config.Lexical.Search(ctx, question, options)
	if err != nil {
		return HybridResult{}, err
	}
	config := retriever.config
	if !config.Metadata.Enabled {
		return fallbackResult(baseline, nil, true, limit), nil
	}
	if config.Semantic == nil || config.Provider == nil {
		return fallbackResult(baseline, retrieval.ErrSemanticUnavailable, false, limit), nil
	}
	batch, semanticErr := config.Provider.Embed(ctx, index.EmbeddingRequest{Purpose: index.PurposeQuery, Inputs: []string{question}})
	if ctx.Err() != nil {
		return HybridResult{}, ctx.Err()
	}
	if semanticErr == nil {
		semanticErr = validateQueryBatch(batch, config.Metadata)
	}
	var semantic []retrieval.SemanticHit
	if semanticErr == nil {
		semantic, semanticErr = config.Semantic.Search(ctx, index.SemanticSearchRequest{Query: batch.Vectors[0], Limit: retriever.semanticLimit(),
			SnapshotHash: config.Metadata.SnapshotHash, ChunkerVersion: config.Metadata.ChunkerVersion,
			ProfileFingerprint: config.Metadata.ProfileFingerprint, Dimensions: config.Metadata.Dimensions})
	}
	if ctx.Err() != nil {
		return HybridResult{}, ctx.Err()
	}
	ranked := retrieval.FuseOrFallback(baseline.Hits, semantic, semanticErr, retrieval.RRFK, limit, false)
	if semanticErr != nil || len(semantic) == 0 {
		return fromRankedBaseline(baseline, ranked), nil
	}
	hits := make([]retrieval.Hit, 0, len(ranked.Hits))
	for _, fused := range ranked.Hits {
		hit, hydrateErr := config.Lexical.ValidateChunk(ctx, fused.ChunkID, fused.FusedScore)
		if hydrateErr != nil {
			if ctx.Err() != nil {
				return HybridResult{}, ctx.Err()
			}
			fresh, retryErr := config.Lexical.Search(ctx, question, options)
			if retryErr != nil {
				return HybridResult{}, retryErr
			}
			return fallbackResult(fresh, retrieval.ErrSemanticStale, false, limit), nil
		}
		hit.Rank = len(hits) + 1
		hits = append(hits, hit)
	}
	return HybridResult{Hits: hits, Warnings: baseline.Warnings, SemanticStatus: ranked.SemanticStatus, WarningCode: ranked.WarningCode}, nil
}

func (retriever *HybridRetriever) limit(requested int) int {
	limit := requested
	if limit == 0 {
		limit = retriever.config.Limits.Limit
	}
	if limit == 0 {
		limit = retrieval.DefaultSearchResults
	}
	if limit > MaxEvidenceEntries {
		limit = MaxEvidenceEntries
	}
	return limit
}

func (retriever *HybridRetriever) semanticLimit() int {
	limit := retriever.config.Limits.SemanticLimit
	if limit == 0 {
		limit = retriever.config.Limits.Limit
	}
	if limit == 0 {
		limit = retrieval.DefaultSearchResults
	}
	if limit > MaxEvidenceEntries {
		limit = MaxEvidenceEntries
	}
	return limit
}

func validateQueryBatch(batch index.EmbeddingBatch, metadata SemanticMetadata) error {
	if batch.Model != metadata.ExpectedModel || batch.Dimensions != metadata.Dimensions || len(batch.Vectors) != 1 || len(batch.Vectors[0]) != metadata.Dimensions {
		return retrieval.ErrSemanticUnavailable
	}
	for _, value := range batch.Vectors[0] {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return retrieval.ErrSemanticUnavailable
		}
	}
	return nil
}

func fallbackResult(baseline retrieval.SearchResult, semanticErr error, disabled bool, limit int) HybridResult {
	ranked := retrieval.FuseOrFallback(baseline.Hits, nil, semanticErr, retrieval.RRFK, limit, disabled)
	return fromRankedBaseline(baseline, ranked)
}

func fromRankedBaseline(baseline retrieval.SearchResult, ranked retrieval.HybridRankResult) HybridResult {
	byID := make(map[string]retrieval.Hit, len(baseline.Hits))
	for _, hit := range baseline.Hits {
		byID[hit.ID] = hit
	}
	hits := make([]retrieval.Hit, 0, len(ranked.Hits))
	for _, fused := range ranked.Hits {
		if hit, ok := byID[fused.ChunkID]; ok {
			hit.Score, hit.Rank = fused.FusedScore, len(hits)+1
			hits = append(hits, hit)
		}
	}
	return HybridResult{Hits: hits, Warnings: baseline.Warnings, SemanticStatus: ranked.SemanticStatus, WarningCode: ranked.WarningCode}
}
