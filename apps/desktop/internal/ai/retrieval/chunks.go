package retrieval

import (
	"context"
	"sort"
)

// Chunks returns a deterministic copy of the chunks owned by the current
// lexical generation. It performs one generation validation and exposes no
// workspace identity, filesystem identity, or hydration seals.
func (index *Lexical) Chunks(ctx context.Context) ([]Chunk, error) {
	if _, err := index.currentGeneration(ctx); err != nil {
		return nil, err
	}
	chunks := make([]Chunk, len(index.documents))
	for i := range index.documents {
		chunks[i] = index.documents[i].chunk
	}
	sort.Slice(chunks, func(i, j int) bool { return chunks[i].ID < chunks[j].ID })
	return chunks, nil
}
