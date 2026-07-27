package retrieval

import "context"

// currentGeneration performs the single bounded corpus scan shared by each
// public index operation. A generation mismatch is global and reveals no path.
func (index *Lexical) currentGeneration(ctx context.Context) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	if index == nil {
		return Snapshot{}, ErrStaleIndex
	}
	snapshot, err := index.corpus.Snapshot(ctx, index.root)
	if err != nil {
		return Snapshot{}, err
	}
	if snapshot.Truncated {
		return Snapshot{}, ErrStaleIndex
	}
	if !sameSnapshotRoot(index.rootIdentity, snapshot.rootIdentity) || snapshot.SnapshotHash != index.snapshotHash {
		return Snapshot{}, ErrStaleIndex
	}
	return snapshot, nil
}
