package providers

import (
	"net/http"
	"strings"
)

func stripCredentials(header http.Header, declared []string) {
	explicit := map[string]bool{}
	for _, key := range declared {
		explicit[http.CanonicalHeaderKey(key)] = true
	}
	for key := range header {
		if explicit[http.CanonicalHeaderKey(key)] || sensitiveHeader(key) {
			header.Del(key)
		}
	}
}

func sensitiveHeader(key string) bool {
	compact := strings.ToLower(strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, key))
	if compact == "cookie" || compact == "authorization" || compact == "proxyauthorization" {
		return true
	}
	for _, marker := range []string{"auth", "apikey", "token", "secret", "signature", "credential"} {
		if strings.Contains(compact, marker) {
			return true
		}
	}
	for _, token := range strings.FieldsFunc(strings.ToLower(key), func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	}) {
		if token == "sig" {
			return true
		}
	}
	return false
}
