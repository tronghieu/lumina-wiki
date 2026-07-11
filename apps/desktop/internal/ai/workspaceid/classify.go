package workspaceid

func classifyCandidate(registry Registry, candidate Candidate) (AttachKind, int) {
	pathMatches := make([]int, 0, 1)
	signatureMatches := make([]int, 0, 1)
	for index, record := range registry.Records {
		if !record.Active {
			continue
		}
		if pathKey(record.CanonicalPath) == pathKey(candidate.CanonicalPath) {
			pathMatches = append(pathMatches, index)
		}
		if candidate.HasSignature && record.FilesystemSignature == candidate.Signature {
			signatureMatches = append(signatureMatches, index)
		}
	}
	if !candidate.HasSignature {
		if len(pathMatches) == 1 {
			return AttachIdentityConfirmationRequired, pathMatches[0]
		}
		return AttachAmbiguousConfirmationRequired, -1
	}
	if len(pathMatches) > 1 || len(signatureMatches) > 1 {
		return AttachAmbiguousConfirmationRequired, -1
	}
	if len(pathMatches) == 1 && len(signatureMatches) == 1 && pathMatches[0] != signatureMatches[0] {
		return AttachAmbiguousConfirmationRequired, -1
	}
	if len(pathMatches) == 1 && len(signatureMatches) == 1 {
		return AttachIdentityConfirmationRequired, pathMatches[0]
	}
	if len(pathMatches) == 1 {
		return AttachPathReuseConfirmationRequired, pathMatches[0]
	}
	if len(signatureMatches) == 1 {
		return AttachRenameConfirmationRequired, signatureMatches[0]
	}
	return AttachNew, -1
}
