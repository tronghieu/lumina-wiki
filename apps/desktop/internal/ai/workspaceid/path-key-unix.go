//go:build !windows

package workspaceid

func pathKey(path string) string { return path }
