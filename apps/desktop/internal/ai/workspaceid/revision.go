package workspaceid

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
)

func registryRevision(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func matchedWorkspaceIDs(registry Registry, candidate Candidate) []WorkspaceID {
	matched := map[WorkspaceID]struct{}{}
	for _, record := range registry.Records {
		if !record.Active {
			continue
		}
		if pathKey(record.CanonicalPath) == pathKey(candidate.CanonicalPath) ||
			(candidate.HasSignature && record.FilesystemSignature == candidate.Signature) {
			matched[record.WorkspaceID] = struct{}{}
		}
	}
	result := make([]WorkspaceID, 0, len(matched))
	for id := range matched {
		result = append(result, id)
	}
	sort.Slice(result, func(left, right int) bool { return result[left] < result[right] })
	return result
}

func sameWorkspaceIDs(left, right []WorkspaceID) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
