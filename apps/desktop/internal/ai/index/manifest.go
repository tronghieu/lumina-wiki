package index

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"sort"
)

const (
	CurrentManifestVersion = 1
	MaxManifestBytes       = 1 << 20
	MaxIndexChunks         = 32768
	MaxMetadataBytes       = 16 << 20
)

var lowerHex32 = regexp.MustCompile(`^[0-9a-f]{32}$`)
var lowerHex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)
var versionToken = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

type Manifest struct {
	Version            int      `json:"version"`
	Generation         string   `json:"generation"`
	ChunkerVersion     string   `json:"chunkerVersion"`
	ProfileFingerprint string   `json:"profileFingerprint"`
	Dimensions         int      `json:"dimensions"`
	SnapshotHash       string   `json:"snapshotHash"`
	DocumentHashes     []string `json:"documentHashes"`
	ChunkCount         int      `json:"chunkCount"`
	VectorCount        int      `json:"vectorCount"`
}

type VectorRef struct {
	ChunkID     string `json:"chunkId"`
	ContentHash string `json:"contentHash"`
	Offset      int64  `json:"offset"`
	Count       int    `json:"count"`
}

func (manifest Manifest) validate() error {
	if manifest.Version != CurrentManifestVersion || !lowerHex32.MatchString(manifest.Generation) ||
		!versionToken.MatchString(manifest.ChunkerVersion) || !lowerHex64.MatchString(manifest.ProfileFingerprint) ||
		manifest.Dimensions < 1 || manifest.Dimensions > MaxVectorDimensions || !lowerHex64.MatchString(manifest.SnapshotHash) ||
		manifest.ChunkCount < 0 || manifest.ChunkCount > MaxIndexChunks || manifest.VectorCount < 0 || manifest.VectorCount > manifest.ChunkCount ||
		len(manifest.DocumentHashes) > MaxIndexChunks {
		return errors.New("semantic index manifest is invalid")
	}
	for i, hash := range manifest.DocumentHashes {
		if !lowerHex64.MatchString(hash) || i > 0 && manifest.DocumentHashes[i-1] >= hash {
			return errors.New("semantic index manifest is invalid")
		}
	}
	return nil
}

func EncodeManifest(manifest Manifest) ([]byte, error) {
	if err := manifest.validate(); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(manifest)
	if err != nil || len(raw)+1 > MaxManifestBytes {
		return nil, errors.New("semantic index manifest is invalid")
	}
	return append(raw, '\n'), nil
}

func DecodeManifest(raw []byte) (Manifest, error) {
	var manifest Manifest
	if len(raw) == 0 || len(raw) > MaxManifestBytes || raw[len(raw)-1] != '\n' || rejectDuplicateJSONKeys(raw) != nil {
		return manifest, errors.New("semantic index manifest is malformed")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&manifest) != nil || requireJSONEOF(decoder) != nil || manifest.validate() != nil {
		return Manifest{}, errors.New("semantic index manifest is malformed")
	}
	return manifest, nil
}

func DecodeVectorRefs(raw []byte, expected, expectedVectors, dimensions int, vectorBytes int64) ([]VectorRef, error) {
	if len(raw) > MaxMetadataBytes || expected < 0 || expected > MaxIndexChunks || expectedVectors < 0 || expectedVectors > expected || dimensions < 1 || dimensions > MaxVectorDimensions || vectorBytes < 0 || vectorBytes > MaxVectorBytes {
		return nil, errors.New("semantic index metadata is invalid")
	}
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 1024), 4096)
	refs := make([]VectorRef, 0, expected)
	seen := make(map[string]struct{}, expected)
	type vectorBlock struct {
		hash        string
		offset, end int64
	}
	blocksByHash := make(map[string]vectorBlock, expectedVectors)
	hashByOffset := make(map[int64]string, expectedVectors)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 || rejectDuplicateJSONKeys(line) != nil || len(refs) >= expected {
			return nil, errors.New("semantic index metadata is malformed")
		}
		var ref VectorRef
		decoder := json.NewDecoder(bytes.NewReader(line))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&ref) != nil || requireJSONEOF(decoder) != nil || !lowerHex64.MatchString(ref.ChunkID) || !lowerHex64.MatchString(ref.ContentHash) || ref.Count != dimensions || ref.Offset < 0 || ref.Offset%4 != 0 {
			return nil, errors.New("semantic index metadata is malformed")
		}
		if _, ok := seen[ref.ChunkID]; ok {
			return nil, errors.New("semantic index metadata is malformed")
		}
		seen[ref.ChunkID] = struct{}{}
		if ref.Offset > vectorBytes || int64(ref.Count) > (vectorBytes-ref.Offset)/4 {
			return nil, errors.New("semantic index metadata is malformed")
		}
		block := vectorBlock{ref.ContentHash, ref.Offset, ref.Offset + int64(ref.Count)*4}
		if previous, ok := blocksByHash[ref.ContentHash]; ok && previous != block {
			return nil, errors.New("semantic index metadata is malformed")
		}
		if hash, ok := hashByOffset[ref.Offset]; ok && hash != ref.ContentHash {
			return nil, errors.New("semantic index metadata is malformed")
		}
		blocksByHash[ref.ContentHash], hashByOffset[ref.Offset] = block, ref.ContentHash
		refs = append(refs, ref)
	}
	if scanner.Err() != nil || len(refs) != expected || len(blocksByHash) != expectedVectors {
		return nil, errors.New("semantic index metadata is malformed")
	}
	blocks := make([]vectorBlock, 0, len(blocksByHash))
	for _, block := range blocksByHash {
		blocks = append(blocks, block)
	}
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].offset < blocks[j].offset })
	end := int64(0)
	for _, block := range blocks {
		if block.offset != end {
			return nil, errors.New("semantic index metadata is malformed")
		}
		end = block.end
	}
	if end != vectorBytes {
		return nil, errors.New("semantic index metadata is malformed")
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].ChunkID < refs[j].ChunkID })
	return refs, nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}
