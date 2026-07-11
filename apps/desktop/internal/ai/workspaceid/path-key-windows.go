//go:build windows

package workspaceid

import "strings"

func pathKey(path string) string { return strings.ToLower(path) }
