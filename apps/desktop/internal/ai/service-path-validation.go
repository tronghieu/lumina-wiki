package ai

import (
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

func displayBasename(root string) (string, error) {
	normalized := strings.TrimRight(strings.ReplaceAll(root, `\`, "/"), "/")
	label := path.Base(normalized)
	if label == "" || label == "." || label == ".." || len(label) > 256 || !utf8.ValidString(label) || strings.ContainsAny(label, `/\`) {
		return "", ErrWorkspaceAttach
	}
	for _, character := range label {
		if !unicode.IsPrint(character) || unicode.Is(unicode.Cf, character) {
			return "", ErrWorkspaceAttach
		}
	}
	return label, nil
}
