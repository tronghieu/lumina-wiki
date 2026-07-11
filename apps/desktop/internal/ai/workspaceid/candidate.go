package workspaceid

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type Candidate struct {
	CanonicalPath string
	Signature     Signature
	HasSignature  bool
}

type Canonicalizer func(string) (string, error)
type SignatureProbe func(string) (Signature, bool, error)

type DirectoryHandle interface {
	Stat() (os.FileInfo, error)
	Close() error
}

type ownedCandidate struct {
	Candidate
	handle DirectoryHandle
}

type OpenDirectory func(string) (DirectoryHandle, error)
type HandleSignature func(DirectoryHandle) (Signature, bool, error)

func canonicalizeRoot(root string) (string, error) {
	if !validCanonicalPath(root) {
		return "", errors.New("workspace root must be an absolute directory")
	}
	before, err := os.Stat(root)
	if err != nil || !before.IsDir() {
		return "", errors.New("workspace root must be an existing directory")
	}
	evaluated, err := filepath.EvalSymlinks(root)
	if err != nil || !filepath.IsAbs(evaluated) {
		return "", errors.New("workspace root cannot be resolved safely")
	}
	evaluated = filepath.Clean(evaluated)
	after, err := os.Stat(evaluated)
	if err != nil || !after.IsDir() || !os.SameFile(before, after) {
		return "", errors.New("workspace root changed while resolving")
	}
	if !validCanonicalPath(evaluated) {
		return "", errors.New("workspace root exceeds the portable path limit")
	}
	return evaluated, nil
}

func resolveOwnedCandidate(root string, canonicalizer Canonicalizer, open OpenDirectory,
	handleProbe HandleSignature, pathProbe SignatureProbe) (ownedCandidate, error) {
	path, err := canonicalizer(root)
	if err != nil || !validCanonicalPath(path) {
		return ownedCandidate{}, errors.New("workspace canonicalization failed")
	}
	handle, err := open(path)
	if err != nil {
		return ownedCandidate{}, errors.New("open workspace identity failed")
	}
	owned := ownedCandidate{Candidate: Candidate{CanonicalPath: path}, handle: handle}
	failed := true
	defer func() {
		if failed {
			_ = handle.Close()
		}
	}()
	if err := revalidateHandle(owned); err != nil {
		return ownedCandidate{}, err
	}
	if pathProbe != nil {
		owned.Signature, owned.HasSignature, err = pathProbe(path)
	} else {
		owned.Signature, owned.HasSignature, err = handleProbe(handle)
	}
	if err != nil || (owned.HasSignature && !validSignature(owned.Signature)) {
		return ownedCandidate{}, errors.New("workspace identity probe failed")
	}
	if err := revalidateHandle(owned); err != nil {
		return ownedCandidate{}, err
	}
	failed = false
	return owned, nil
}

func revalidateHandle(candidate ownedCandidate) error {
	handleInfo, err := candidate.handle.Stat()
	if err != nil || !handleInfo.IsDir() {
		return ErrCandidateChanged
	}
	pathInfo, err := os.Stat(candidate.CanonicalPath)
	if err != nil || !pathInfo.IsDir() || !os.SameFile(handleInfo, pathInfo) {
		return ErrCandidateChanged
	}
	return nil
}

func defaultHandleSignature(handle DirectoryHandle) (Signature, bool, error) {
	return platformHandleSignature(handle)
}

func validCanonicalPath(path string) bool {
	if path == "" || len(path) > MaxCanonicalPathBytes || strings.ContainsRune(path, '\x00') {
		return false
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	volume := filepath.VolumeName(path)
	if volume != "" && len(path) <= len(volume) {
		return false
	}
	return true
}

func validSignature(signature Signature) bool {
	if len(signature) == 0 || len(signature) > MaxSignatureBytes {
		return false
	}
	for _, char := range string(signature) {
		if char < 0x21 || char > 0x7e {
			return false
		}
	}
	return true
}
