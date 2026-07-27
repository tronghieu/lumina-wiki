package index

import (
	"context"
	"errors"
	"io"
	"os"
	"sort"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

const DefaultSemanticSearchResults = 10

type vectorBlock struct {
	hash   string
	offset int64
	count  int
	ids    []string
}

func (store *Store) Search(ctx context.Context, request SemanticSearchRequest) ([]retrieval.SemanticHit, error) {
	query, limit, err := validateSearchRequest(ctx, request)
	if err != nil {
		return nil, err
	}
	var snapshot *searchSnapshot
	err = store.withReadLocked(ctx, func(root *os.Root) error {
		var captureErr error
		snapshot, captureErr = store.captureSearch(root, request)
		return captureErr
	})
	if err != nil {
		return nil, semanticSearchError(ctx.Err(), err)
	}
	defer snapshot.file.Close()
	if store.searchAfterOpen != nil {
		store.searchAfterOpen()
	}
	hits, err := scanVectors(ctx, snapshot, query, limit)
	if err != nil {
		return nil, semanticSearchError(ctx.Err(), err)
	}
	err = store.withReadLocked(ctx, func(root *os.Root) error {
		if store.requireRevision(root, snapshot.revision) != nil {
			return ErrSemanticStale
		}
		return nil
	})
	if err != nil {
		return nil, semanticSearchError(ctx.Err(), err)
	}
	for i := range hits {
		hits[i].Rank = i + 1
	}
	return hits, nil
}

func validateSearchRequest(ctx context.Context, request SemanticSearchRequest) ([]float32, int, error) {
	if err := ctx.Err(); err != nil {
		return nil, 0, err
	}
	limit := request.Limit
	if limit == 0 {
		limit = DefaultSemanticSearchResults
	}
	if limit < 1 || limit > retrieval.MaxSearchResults || request.Dimensions < 1 || request.Dimensions > MaxVectorDimensions ||
		len(request.Query) != request.Dimensions || !lowerHex64.MatchString(request.SnapshotHash) ||
		!versionToken.MatchString(request.ChunkerVersion) || !lowerHex64.MatchString(request.ProfileFingerprint) {
		return nil, 0, ErrSemanticUnavailable
	}
	query := append([]float32(nil), request.Query...)
	if !validVector(query) {
		return nil, 0, ErrSemanticUnavailable
	}
	return query, limit, nil
}

func scanVectors(ctx context.Context, snapshot *searchSnapshot, query []float32, limit int) ([]retrieval.SemanticHit, error) {
	blocks := groupVectorBlocks(snapshot.refs)
	top := make([]retrieval.SemanticHit, 0, limit)
	raw := make([]byte, snapshot.manifest.Dimensions*4)
	for _, block := range blocks {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		n, err := snapshot.file.ReadAt(raw, block.offset)
		if n != len(raw) || err != nil && !errors.Is(err, io.EOF) {
			return nil, ErrSemanticCorrupt
		}
		vector, err := DecodeFloat32LE(raw, block.count)
		if err != nil {
			return nil, ErrSemanticCorrupt
		}
		score, err := CosineExact(query, vector)
		if err != nil {
			return nil, ErrSemanticCorrupt
		}
		for _, id := range block.ids {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			top = addSemanticTop(top, retrieval.SemanticHit{ChunkID: id, Score: score}, limit)
		}
	}
	return top, nil
}

func groupVectorBlocks(refs []VectorRef) []vectorBlock {
	byHash := make(map[string]*vectorBlock)
	for _, ref := range refs {
		block := byHash[ref.ContentHash]
		if block == nil {
			block = &vectorBlock{hash: ref.ContentHash, offset: ref.Offset, count: ref.Count}
			byHash[ref.ContentHash] = block
		}
		block.ids = append(block.ids, ref.ChunkID)
	}
	blocks := make([]vectorBlock, 0, len(byHash))
	for _, block := range byHash {
		sort.Strings(block.ids)
		blocks = append(blocks, *block)
	}
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].offset < blocks[j].offset })
	return blocks
}

func addSemanticTop(top []retrieval.SemanticHit, hit retrieval.SemanticHit, limit int) []retrieval.SemanticHit {
	top = append(top, hit)
	sort.Slice(top, func(i, j int) bool {
		if top[i].Score != top[j].Score {
			return top[i].Score > top[j].Score
		}
		return top[i].ChunkID < top[j].ChunkID
	})
	if len(top) > limit {
		top = top[:limit]
	}
	return top
}
