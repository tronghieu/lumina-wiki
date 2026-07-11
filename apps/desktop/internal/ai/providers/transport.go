package providers

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"strings"
	"time"
)

type DialContextFunc func(context.Context, string, string) (net.Conn, error)
type TransportOptions struct {
	DialContext                                                    DialContextFunc
	DialTimeout, KeepAlive, IdleConnTimeout, ResponseHeaderTimeout time.Duration
	TLSHandshakeTimeout                                            time.Duration
	MaxResponseBytes                                               int64
}

func (o TransportOptions) withDefaults() TransportOptions {
	if o.DialTimeout <= 0 {
		o.DialTimeout = 10 * time.Second
	}
	if o.KeepAlive <= 0 {
		o.KeepAlive = 30 * time.Second
	}
	if o.IdleConnTimeout <= 0 {
		o.IdleConnTimeout = 90 * time.Second
	}
	if o.ResponseHeaderTimeout <= 0 {
		o.ResponseHeaderTimeout = 30 * time.Second
	}
	if o.TLSHandshakeTimeout <= 0 {
		o.TLSHandshakeTimeout = 10 * time.Second
	}
	if o.MaxResponseBytes <= 0 {
		o.MaxResponseBytes = 16 << 20
	}
	return o
}

func NewPinnedTransport(endpoint ApprovedEndpoint, options TransportOptions) (*http.Transport, error) {
	if len(endpoint.addrs) == 0 || endpoint.port == "" {
		return nil, endpointRejected()
	}
	options = options.withDefaults()
	dial := options.DialContext
	if dial == nil {
		d := &net.Dialer{Timeout: options.DialTimeout, KeepAlive: options.KeepAlive}
		dial = d.DialContext
	}
	pinned := func(ctx context.Context, network, address string) (net.Conn, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if network != "tcp" && network != "tcp4" && network != "tcp6" {
			return nil, endpointRejected()
		}
		host, port, err := net.SplitHostPort(address)
		if err != nil || !strings.EqualFold(strings.TrimSuffix(host, "."), endpoint.serverName) || port != endpoint.port {
			return nil, endpointRejected()
		}
		dialCtx, cancel := context.WithTimeout(ctx, options.DialTimeout)
		defer cancel()
		var last error
		for _, addr := range endpoint.addrs {
			if network == "tcp4" && !addr.Is4() || network == "tcp6" && !addr.Is6() {
				continue
			}
			conn, err := dial(dialCtx, network, net.JoinHostPort(addr.String(), port))
			if err == nil {
				return conn, nil
			}
			last = err
			if dialCtx.Err() != nil {
				return nil, safeFailure("endpoint_connect", "The provider endpoint could not be reached.", dialCtx.Err())
			}
		}
		return nil, safeFailure("endpoint_connect", "The provider endpoint could not be reached.", last)
	}
	return &http.Transport{Proxy: nil, DialContext: pinned, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: endpoint.serverName}, TLSHandshakeTimeout: options.TLSHandshakeTimeout, IdleConnTimeout: options.IdleConnTimeout, ResponseHeaderTimeout: options.ResponseHeaderTimeout, ForceAttemptHTTP2: true}, nil
}

type SafeClient struct {
	Policy            EndpointPolicy
	Options           TransportOptions
	MaxRedirects      int
	CredentialHeaders []string
	NewRoundTripper   func(ApprovedEndpoint) http.RoundTripper
}

func (c SafeClient) Do(original *http.Request) (*http.Response, error) {
	if original == nil {
		return nil, NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	if original.URL == nil {
		closeRequestBody(original)
		return nil, NewSafeError("invalid_request", "The provider request is invalid.", nil)
	}
	max := c.MaxRedirects
	if max <= 0 {
		max = 5
	}
	credentialOrigin := ""
	current := original.Clone(original.Context())
	needsReplay := false
	for redirects := 0; ; redirects++ {
		approved, err := c.Policy.Approve(current.Context(), current.URL.String())
		if err != nil {
			closeRequestBody(current)
			return nil, err
		}
		if redirects == 0 {
			credentialOrigin = approved.Origin()
		}
		if approved.Origin() != credentialOrigin {
			stripCredentials(current.Header, c.CredentialHeaders)
		}
		current.URL = approved.URL()
		current.Host = ""
		rt := http.RoundTripper(nil)
		if c.NewRoundTripper != nil {
			rt = c.NewRoundTripper(approved)
		} else {
			rt, err = NewPinnedTransport(approved, c.Options)
			if err != nil {
				closeRequestBody(current)
				return nil, err
			}
		}
		if rt == nil {
			closeRequestBody(current)
			return nil, NewSafeError("transport_unavailable", "The provider transport is unavailable.", nil)
		}
		if needsReplay {
			body, replayErr := current.GetBody()
			if replayErr != nil {
				if body != nil {
					_ = body.Close()
				}
				closeIdle(rt)
				return nil, NewSafeError("redirect_body_not_replayable", "The provider redirect requires a replayable request body.", replayErr)
			}
			current.Body = body
			needsReplay = false
		}
		resp, err := rt.RoundTrip(current)
		if err != nil {
			closeIdle(rt)
			return nil, safeFailure("provider_request", "The provider request failed.", err)
		}
		if !isRedirect(resp.StatusCode) {
			resp.Body = newBoundedBody(resp.Body, c.Options.withDefaults().MaxResponseBytes, func() { closeIdle(rt) })
			return resp, nil
		}
		location := resp.Header.Get("Location")
		resp.Body.Close()
		closeIdle(rt)
		if location == "" {
			return nil, NewSafeError("redirect_invalid", "The provider returned an invalid redirect.", nil)
		}
		if redirects >= max {
			return nil, NewSafeError("redirect_limit", "The provider returned too many redirects.", nil)
		}
		next, err := current.URL.Parse(location)
		if err != nil {
			return nil, NewSafeError("redirect_invalid", "The provider returned an invalid redirect.", err)
		}
		if current.URL.Scheme == "https" && next.Scheme != "https" {
			return nil, NewSafeError("redirect_downgrade", "The provider redirect was not secure.", nil)
		}
		current, needsReplay, err = redirectRequest(current, next, resp.StatusCode)
		if err != nil {
			return nil, err
		}
	}
}
func closeRequestBody(request *http.Request) {
	if request != nil && request.Body != nil {
		_ = request.Body.Close()
		request.Body = nil
	}
}

type idleCloser interface{ CloseIdleConnections() }

func closeIdle(rt http.RoundTripper) {
	if closer, ok := rt.(idleCloser); ok {
		closer.CloseIdleConnections()
	}
}
func isRedirect(status int) bool {
	return status == 301 || status == 302 || status == 303 || status == 307 || status == 308
}
