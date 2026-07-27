package settings

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"unicode"
)

func normalizeBaseURL(raw string) (string, error) {
	if raw == "" || strings.TrimSpace(raw) != raw {
		return "", errors.New("base URL must be non-empty without surrounding whitespace")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.Opaque != "" {
		return "", errors.New("base URL must be an absolute URL")
	}
	// ParseQuery returns syntax errors that URL.Query silently discards.
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return "", errors.New("base URL query is malformed")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	if u.User != nil || u.Fragment != "" {
		return "", errors.New("base URL must not contain userinfo or a fragment")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", errors.New("base URL scheme must be HTTPS or loopback HTTP")
	}
	if err := validateExplicitPort(u); err != nil {
		return "", err
	}
	if u.Scheme == "http" {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return "", errors.New("HTTP base URLs require a literal loopback host")
		}
	}
	for key := range query {
		if credentialLikeQueryKey(key) {
			return "", fmt.Errorf("base URL query key %q may contain credentials", key)
		}
	}
	port := u.Port()
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawQuery = query.Encode()
	return u.String(), nil
}

func validateExplicitPort(u *url.URL) error {
	host := u.Host
	explicit := false
	if strings.HasPrefix(host, "[") {
		if end := strings.LastIndex(host, "]"); end >= 0 {
			explicit = len(host) > end+1
		}
	} else {
		explicit = strings.Contains(host, ":")
	}
	if !explicit {
		return nil
	}
	port := u.Port()
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return errors.New("base URL port must be an integer between 1 and 65535")
	}
	return nil
}

func credentialLikeQueryKey(key string) bool {
	tokens := queryKeyTokens(key)
	for index, token := range tokens {
		if credentialToken(token) {
			return true
		}
		if (token == "api" || token == "access") && index+1 < len(tokens) && tokens[index+1] == "key" {
			return true
		}
	}
	compact := strings.ToLower(strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return r
		}
		return -1
	}, key))
	for _, suffix := range []string{"token", "tokens", "secret", "secrets", "password", "passwords", "credential", "credentials", "signature", "signatures"} {
		if strings.HasSuffix(compact, suffix) {
			return true
		}
	}
	for _, marker := range []string{"apikey", "accesskey"} {
		if index := strings.Index(compact, marker); index >= 0 {
			tail := compact[index+len(marker):]
			if tail == "" || tail == "id" {
				return true
			}
		}
	}
	return compact == "key" || compact == "auth" || compact == "authentication" || compact == "authorization" || compact == "sig"
}

func credentialToken(token string) bool {
	switch token {
	case "auth", "authentication", "authorization", "token", "secret", "password", "credential", "signature", "sig":
		return true
	default:
		return false
	}
}

func queryKeyTokens(key string) []string {
	var tokens []string
	start := 0
	runes := []rune(key)
	flush := func(end int) {
		if start < end {
			tokens = append(tokens, strings.ToLower(string(runes[start:end])))
		}
	}
	for index, current := range runes {
		if !unicode.IsLetter(current) && !unicode.IsDigit(current) {
			flush(index)
			start = index + 1
		} else if index > start && unicode.IsUpper(current) && unicode.IsLower(runes[index-1]) {
			flush(index)
			start = index
		}
	}
	flush(len(runes))
	return tokens
}
