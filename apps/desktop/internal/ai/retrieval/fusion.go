package retrieval

import (
	"context"
	"errors"
	"math"
	"sort"
)

const (
	HybridVersion              = "lumina-hybrid-rrf-v1"
	RRFK                       = 60.0
	MaxHybridCandidates        = 32768
	WarningSemanticUnavailable = "semantic_unavailable"
	WarningSemanticStale       = "semantic_stale"
	WarningSemanticCorrupt     = "semantic_corrupt"
	WarningSemanticCanceled    = "semantic_canceled"
)

var (
	ErrSemanticEmpty       = errors.New("semantic index is empty")
	ErrSemanticStale       = errors.New("semantic index is stale")
	ErrSemanticCorrupt     = errors.New("semantic index is corrupt")
	ErrSemanticUnavailable = errors.New("semantic index is unavailable")
)

type SemanticHit struct {
	ChunkID string  `json:"chunkId"`
	Score   float64 `json:"score"`
	Rank    int     `json:"rank"`
}

type FusedHit struct {
	ChunkID      string  `json:"chunkId"`
	FusedScore   float64 `json:"fusedScore"`
	LexicalRank  int     `json:"lexicalRank,omitempty"`
	SemanticRank int     `json:"semanticRank,omitempty"`
}

type SemanticStatus string

const (
	SemanticReady       SemanticStatus = "ready"
	SemanticDisabled    SemanticStatus = "disabled"
	SemanticEmpty       SemanticStatus = "empty"
	SemanticUnavailable SemanticStatus = "unavailable"
	SemanticStale       SemanticStatus = "stale"
	SemanticCorrupt     SemanticStatus = "corrupt"
	SemanticCanceled    SemanticStatus = "canceled"
)

type HybridRankResult struct {
	Hits           []FusedHit     `json:"hits"`
	SemanticStatus SemanticStatus `json:"semanticStatus"`
	WarningCode    string         `json:"warningCode,omitempty"`
}

type rankPair struct{ lexical, semantic int }

func FuseRanks(lexical []Hit, semantic []SemanticHit, k float64, limit int) []FusedHit {
	if !validFusionBounds(len(lexical), len(semantic), k, limit) {
		return []FusedHit{}
	}
	ranks := make(map[string]rankPair, len(lexical)+len(semantic))
	for _, hit := range lexical {
		if !validRankedID(hit.ID, hit.Score, hit.Rank) {
			continue
		}
		pair := ranks[hit.ID]
		if pair.lexical == 0 || hit.Rank < pair.lexical {
			pair.lexical = hit.Rank
		}
		ranks[hit.ID] = pair
	}
	for _, hit := range semantic {
		if !validRankedID(hit.ChunkID, hit.Score, hit.Rank) {
			continue
		}
		pair := ranks[hit.ChunkID]
		if pair.semantic == 0 || hit.Rank < pair.semantic {
			pair.semantic = hit.Rank
		}
		ranks[hit.ChunkID] = pair
	}
	result := make([]FusedHit, 0, len(ranks))
	for id, pair := range ranks {
		score := 0.0
		if pair.lexical > 0 {
			score += 1 / (k + float64(pair.lexical))
		}
		if pair.semantic > 0 {
			score += 1 / (k + float64(pair.semantic))
		}
		result = append(result, FusedHit{ChunkID: id, FusedScore: score, LexicalRank: pair.lexical, SemanticRank: pair.semantic})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].FusedScore != result[j].FusedScore {
			return result[i].FusedScore > result[j].FusedScore
		}
		bi, bj := bestRank(result[i]), bestRank(result[j])
		if bi != bj {
			return bi < bj
		}
		return result[i].ChunkID < result[j].ChunkID
	})
	if len(result) > limit {
		result = result[:limit]
	}
	return result
}

func FuseOrFallback(lexical []Hit, semantic []SemanticHit, semanticErr error, k float64, limit int, disabled bool) HybridRankResult {
	status, warning := semanticFailureStatus(semanticErr, disabled)
	if semanticErr != nil || disabled || len(semantic) == 0 {
		if !disabled && semanticErr == nil {
			status = SemanticEmpty
		}
		semantic = nil
	}
	return HybridRankResult{Hits: FuseRanks(lexical, semantic, k, limit), SemanticStatus: status, WarningCode: warning}
}

func validFusionBounds(a, b int, k float64, limit int) bool {
	return a >= 0 && b >= 0 && a <= MaxHybridCandidates && b <= MaxHybridCandidates &&
		!math.IsNaN(k) && !math.IsInf(k, 0) && k > 0 && limit > 0 && limit <= MaxSearchResults
}

func validRankedID(id string, score float64, rank int) bool {
	return chunkIDPattern.MatchString(id) && !math.IsNaN(score) && !math.IsInf(score, 0) && rank > 0 && rank <= MaxHybridCandidates
}

func bestRank(hit FusedHit) int {
	if hit.LexicalRank == 0 {
		return hit.SemanticRank
	}
	if hit.SemanticRank == 0 || hit.LexicalRank < hit.SemanticRank {
		return hit.LexicalRank
	}
	return hit.SemanticRank
}

func semanticFailureStatus(err error, disabled bool) (SemanticStatus, string) {
	if disabled {
		return SemanticDisabled, ""
	}
	switch {
	case err == nil:
		return SemanticReady, ""
	case errors.Is(err, ErrSemanticEmpty):
		return SemanticEmpty, ""
	case errors.Is(err, ErrSemanticStale):
		return SemanticStale, WarningSemanticStale
	case errors.Is(err, ErrSemanticCorrupt):
		return SemanticCorrupt, WarningSemanticCorrupt
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return SemanticCanceled, WarningSemanticCanceled
	default:
		return SemanticUnavailable, WarningSemanticUnavailable
	}
}
