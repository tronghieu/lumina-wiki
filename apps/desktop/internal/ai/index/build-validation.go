package index

import (
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
)

func (store *Store) validateBuild(request BuildRequest) ([]retrieval.Chunk, error) {
	if string(request.WorkspaceID) != store.workspaceID || !request.WorkspaceID.Valid() ||
		!lowerHex64.MatchString(request.SnapshotHash) || !versionToken.MatchString(request.ChunkerVersion) ||
		!lowerHex64.MatchString(request.ProfileFingerprint) || request.ExpectedModel == "" || len(request.ExpectedModel) > 200 ||
		request.ExpectedDimensions < 0 || request.ExpectedDimensions > MaxVectorDimensions || len(request.Chunks) > MaxIndexChunks ||
		len(request.Chunks) > 0 && request.Provider == nil {
		return nil, errors.New("semantic index build request is invalid")
	}
	chunks := append([]retrieval.Chunk(nil), request.Chunks...)
	sort.Slice(chunks, func(i, j int) bool { return chunks[i].ID < chunks[j].ID })
	seen := make(map[string]struct{}, len(chunks))
	textBytes := 0
	for _, chunk := range chunks {
		runes := utf8.RuneCountInString(chunk.Text)
		if !lowerHex64.MatchString(chunk.ID) || !lowerHex64.MatchString(chunk.ContentHash) || chunk.SnapshotHash != request.SnapshotHash ||
			chunk.Text == "" || !utf8.ValidString(chunk.Text) || !utf8.ValidString(chunk.Path) || !utf8.ValidString(chunk.Heading) ||
			len(chunk.Text) > retrieval.MaxChunkBytes || len(chunk.Heading) > retrieval.MaxChunkBytes || len(chunk.Path) > retrieval.MaxRelativePathBytes ||
			chunk.ContentHash != retrieval.ContentHash(chunk.Text) || chunk.Start < 0 || chunk.End <= chunk.Start || chunk.End > retrieval.MaxFileBytes || chunk.End-chunk.Start != runes ||
			chunk.ID != retrieval.ChunkID(chunk.Path, chunk.Start, chunk.End, chunk.ContentHash) || !validChunkPath(chunk.Path) ||
			textBytes > retrieval.MaxIndexTextBytes-len(chunk.Text) {
			return nil, errors.New("semantic index build request is invalid")
		}
		if _, exists := seen[chunk.ID]; exists {
			return nil, errors.New("semantic index build request is invalid")
		}
		seen[chunk.ID] = struct{}{}
		textBytes += len(chunk.Text)
	}
	return chunks, nil
}

func validateManifestCapacity(request BuildRequest, chunks []retrieval.Chunk) error {
	dimensions := request.ExpectedDimensions
	if dimensions == 0 {
		dimensions = MaxVectorDimensions
	}
	manifest := Manifest{Version: CurrentManifestVersion, Generation: strings.Repeat("0", 32), ChunkerVersion: request.ChunkerVersion,
		ProfileFingerprint: request.ProfileFingerprint, Dimensions: dimensions, SnapshotHash: request.SnapshotHash,
		DocumentHashes: documentHashes(chunks), ChunkCount: len(chunks), VectorCount: len(chunks)}
	if _, err := EncodeManifest(manifest); err != nil {
		return errors.New("semantic index manifest exceeds limit")
	}
	return nil
}

func validChunkPath(path string) bool {
	if !utf8.ValidString(path) || strings.Contains(path, "\\") || !strings.HasPrefix(path, "wiki/") || !strings.HasSuffix(path, ".md") {
		return false
	}
	if filepath.ToSlash(filepath.Clean(filepath.FromSlash(path))) != path {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}
