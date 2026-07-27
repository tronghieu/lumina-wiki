package retrieval

import (
	"context"
	"errors"
	"math"
	"regexp"
)

var (
	ErrUnknownChunk = errors.New("unknown chunk ID")
	ErrUnsealedHit  = errors.New("unsealed retrieval hit")
	ErrForeignHit   = errors.New("foreign retrieval hit")
)

var chunkIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ValidateChunk hydrates an ID already owned by this index into a current,
// citeable hit. It never accepts a path or workspace root.
func (index *Lexical) ValidateChunk(ctx context.Context, chunkID string, score float64) (Hit, error) {
	if err := ctx.Err(); err != nil {
		return Hit{}, err
	}
	if index == nil || len(chunkID) != 64 || !chunkIDPattern.MatchString(chunkID) {
		return Hit{}, ErrUnknownChunk
	}
	if math.IsNaN(score) || math.IsInf(score, 0) {
		return Hit{}, ErrLimitReached
	}
	snapshot, err := index.currentGeneration(ctx)
	if err != nil {
		return Hit{}, err
	}
	document, ok := index.byChunkID[chunkID]
	if !ok {
		return Hit{}, ErrUnknownChunk
	}
	result, err := index.freshHits(ctx, snapshot, []Hit{index.sealHit(document, score)}, 1)
	if err != nil {
		return Hit{}, err
	}
	if len(result.Hits) != 1 {
		return Hit{}, ErrStaleIndex
	}
	return result.Hits[0], nil
}
