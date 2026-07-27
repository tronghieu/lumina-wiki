package providers

import (
	"io"
	"net/http"
	"strings"
	"time"
)

func statusError(status int) error { return statusErrorAt(status, "", time.Now()) }

func statusErrorAt(status int, retryAfter string, now time.Time) error {
	code, retryable := "provider_error", false
	switch status {
	case 400:
		code = "invalid_request"
	case 401:
		code = "invalid_credential"
	case 403:
		code = "permission_denied"
	case 404:
		code = "endpoint_or_model_not_found"
	case 408:
		code = "timeout"
	case 409:
		code = "conflict"
	case 413:
		code = "request_too_large"
	case 429:
		code, retryable = "rate_limited", true
	case 500, 502, 503, 504:
		code, retryable = "provider_unavailable", true
	default:
		if status >= 400 && status <= 499 {
			code = "provider_status"
		} else if status >= 500 && status <= 599 {
			code, retryable = "provider_unavailable", true
		}
	}
	delay, hasDelay := time.Duration(0), false
	if retryable {
		delay, hasDelay = parseRetryAfter(retryAfter, now)
	}
	err := newClassifiedSafeError(code, "The provider rejected the request.", nil, retryable, delay)
	err.hasRetryAfter = hasDelay
	return err
}

func retryAfterDelay(value string, now time.Time) time.Duration {
	delay, _ := parseRetryAfter(value, now)
	return delay
}

func parseRetryAfter(value string, now time.Time) (time.Duration, bool) {
	const maximum = 30 * time.Second
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	seconds, numeric := 0, true
	for i := 0; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			numeric = false
			break
		}
		digit := int(value[i] - '0')
		if seconds > 3 || seconds == 3 && digit > 0 {
			return maximum, true
		}
		seconds = seconds*10 + digit
	}
	if numeric {
		return time.Duration(seconds) * time.Second, true
	}
	when, err := http.ParseTime(value)
	if err != nil || when.Before(now) {
		return 0, false
	}
	delay := when.Sub(now)
	if delay > maximum {
		return maximum, true
	}
	return delay, true
}

func drainAndClose(body io.ReadCloser) {
	if body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 32<<10))
	_ = body.Close()
}
