package ai

import "regexp"

var credentialReferencePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

func validCredentialReference(reference string, allowEmpty bool) bool {
	if reference == "" {
		return allowEmpty
	}
	return credentialReferencePattern.MatchString(reference)
}
