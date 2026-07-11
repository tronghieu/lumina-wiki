package providers

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

const MaxDNSAnswers = 16

type Resolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}
type systemResolver struct{}

func (systemResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

type ApprovedEndpoint struct {
	normalized               url.URL
	origin, serverName, port string
	addrs                    []netip.Addr
}

func (a ApprovedEndpoint) URL() *url.URL               { u := a.normalized; return &u }
func (a ApprovedEndpoint) Origin() string              { return a.origin }
func (a ApprovedEndpoint) ServerName() string          { return a.serverName }
func (a ApprovedEndpoint) ApprovedAddrs() []netip.Addr { return append([]netip.Addr(nil), a.addrs...) }

type EndpointPolicy struct {
	Resolver   Resolver
	MaxAnswers int
}

func (p EndpointPolicy) Approve(ctx context.Context, raw string) (ApprovedEndpoint, error) {
	u, err := parseEndpoint(raw)
	if err != nil {
		return ApprovedEndpoint{}, err
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	u.Host = normalizedAuthority(host, u.Port(), u.Scheme)
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	if literal, err := netip.ParseAddr(host); err == nil {
		if literal.Is4In6() {
			return ApprovedEndpoint{}, endpointRejected()
		}
		if u.Scheme == "http" {
			if !literal.IsLoopback() {
				return ApprovedEndpoint{}, endpointRejected()
			}
		} else if !allowedPublic(literal) {
			return ApprovedEndpoint{}, endpointRejected()
		}
		return approved(u, host, port, []netip.Addr{literal}), nil
	}
	if u.Scheme != "https" || !validDNSName(host) {
		return ApprovedEndpoint{}, endpointRejected()
	}
	r := p.Resolver
	if r == nil {
		r = systemResolver{}
	}
	answers, lookupErr := r.LookupIPAddr(ctx, host)
	if lookupErr != nil {
		return ApprovedEndpoint{}, safeFailure("endpoint_dns", "The provider endpoint could not be resolved.", lookupErr)
	}
	capAnswers := p.MaxAnswers
	if capAnswers == 0 {
		capAnswers = MaxDNSAnswers
	}
	if len(answers) == 0 || len(answers) > capAnswers {
		return ApprovedEndpoint{}, endpointRejected()
	}
	seen := map[netip.Addr]bool{}
	addrs := make([]netip.Addr, 0, len(answers))
	for _, answer := range answers {
		if answer.Zone != "" {
			return ApprovedEndpoint{}, endpointRejected()
		}
		addr, ok := netip.AddrFromSlice(answer.IP)
		if !ok || addr.Is4In6() || !allowedPublic(addr) {
			return ApprovedEndpoint{}, endpointRejected()
		}
		if !seen[addr] {
			seen[addr] = true
			addrs = append(addrs, addr)
		}
	}
	sort.Slice(addrs, func(i, j int) bool { return addrs[i].Compare(addrs[j]) < 0 })
	return approved(u, host, port, addrs), nil
}
func approved(u *url.URL, host, port string, addrs []netip.Addr) ApprovedEndpoint {
	origin := u.Scheme + "://" + normalizedAuthority(host, u.Port(), u.Scheme)
	return ApprovedEndpoint{normalized: *u, origin: origin, serverName: host, port: port, addrs: append([]netip.Addr(nil), addrs...)}
}

func parseEndpoint(raw string) (*url.URL, error) {
	if raw == "" || raw != strings.TrimSpace(raw) {
		return nil, endpointRejected()
	}
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() || u.Host == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, endpointRejected()
	}
	if err := validPort(u); err != nil {
		return nil, endpointRejected()
	}
	if u.RawQuery != "" || u.ForceQuery {
		return nil, endpointRejected()
	}
	u.Scheme = strings.ToLower(u.Scheme)
	return u, nil
}
func validPort(u *url.URL) error {
	host := u.Host
	explicit := strings.HasPrefix(host, "[") && strings.Contains(host, "]:") || !strings.HasPrefix(host, "[") && strings.Contains(host, ":")
	if !explicit {
		return nil
	}
	n, err := strconv.Atoi(u.Port())
	if err != nil || n < 1 || n > 65535 {
		return errors.New("invalid port")
	}
	return nil
}
func normalizedAuthority(host, port, scheme string) string {
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		return net.JoinHostPort(strings.Trim(host, "[]"), port)
	}
	return host
}
func validDNSName(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	for _, r := range host {
		if r > 127 {
			return false
		}
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}
func endpointRejected() error {
	return NewSafeError("endpoint_rejected", "The provider endpoint is not allowed.", nil)
}
