package providers

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"testing"
)

type fakeResolver struct {
	answers map[string][]net.IPAddr
	err     error
	calls   int
}

func (f *fakeResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	f.calls++
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, f.err
	}
	return append([]net.IPAddr(nil), f.answers[host]...), nil
}

func resolverFor(host string, ips ...string) *fakeResolver {
	out := &fakeResolver{answers: map[string][]net.IPAddr{host: {}}}
	for _, s := range ips {
		ip := net.ParseIP(s)
		if !strings.Contains(s, ":") {
			ip = ip.To4()
		}
		out.answers[host] = append(out.answers[host], net.IPAddr{IP: ip})
	}
	return out
}

func TestEndpointNormalizationAndApproval(t *testing.T) {
	r := resolverFor("example.com", "93.184.216.34")
	a, err := (EndpointPolicy{Resolver: r}).Approve(context.Background(), "HTTPS://EXAMPLE.COM.:443/v1/")
	if err != nil {
		t.Fatal(err)
	}
	if a.URL().String() != "https://example.com/v1/" || a.Origin() != "https://example.com" || a.ServerName() != "example.com" {
		t.Fatalf("unexpected approval: %s %s %s", a.URL(), a.Origin(), a.ServerName())
	}
	got := a.ApprovedAddrs()
	got[0] = netip.MustParseAddr("1.1.1.1")
	if a.ApprovedAddrs()[0].String() != "93.184.216.34" {
		t.Fatal("approved addresses must be immutable")
	}
}

func TestEndpointRejectsInvalidSyntaxBeforeDNS(t *testing.T) {
	r := resolverFor("example.com", "93.184.216.34")
	bad := []string{"", " /relative", "ftp://example.com", "https://u:p@example.com", "https://example.com/#x", "https://example.com:0", "https://example.com:99999", "https://example.com/?api_key=x", "https://example.com?ordinary=x", "https://example.com?key=x", "https://example.com?sig=x", "https://example.com?token_value=x", "https://münich.example"}
	for _, raw := range bad {
		if _, err := (EndpointPolicy{Resolver: r}).Approve(context.Background(), raw); err == nil {
			t.Errorf("allowed %q", raw)
		}
	}
	if r.calls != 0 {
		t.Fatalf("DNS called %d times", r.calls)
	}
}

func TestEndpointHTTPOnlyLiteralLoopback(t *testing.T) {
	p := EndpointPolicy{Resolver: &fakeResolver{}}
	for _, ok := range []string{"http://127.0.0.1:8080/v1", "http://127.9.8.7", "http://[::1]:80"} {
		if _, err := p.Approve(context.Background(), ok); err != nil {
			t.Errorf("reject %s: %v", ok, err)
		}
	}
	for _, bad := range []string{"http://localhost:8080", "http://0.0.0.0", "http://192.168.1.1", "http://[::ffff:127.0.0.1]"} {
		if _, err := p.Approve(context.Background(), bad); err == nil {
			t.Errorf("allowed %s", bad)
		}
	}
}

func TestEndpointRejectsSpecialAndMixedDNSAnswers(t *testing.T) {
	bad := []string{"0.0.0.0", "127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "192.0.2.1", "198.18.0.1", "224.0.0.1", "::", "::1", "fc00::1", "fe80::1", "2001:db8::1", "ff00::1", "::ffff:127.0.0.1"}
	for _, ip := range bad {
		t.Run(ip, func(t *testing.T) {
			_, err := (EndpointPolicy{Resolver: resolverFor("example.com", ip)}).Approve(context.Background(), "https://example.com")
			if err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
	_, err := (EndpointPolicy{Resolver: resolverFor("example.com", "93.184.216.34", "10.0.0.1")}).Approve(context.Background(), "https://example.com")
	if err == nil {
		t.Fatal("mixed answers must reject")
	}
}

func TestEndpointResolverFailuresAreRedactedAndCapped(t *testing.T) {
	r := &fakeResolver{err: errors.New("lookup private.example at 10.0.0.1 secret")}
	_, err := (EndpointPolicy{Resolver: r}).Approve(context.Background(), "https://private.example")
	if err == nil {
		t.Fatal("expected error")
	}
	for _, bad := range []string{"private.example", "10.0.0.1", "secret", "sensitive"} {
		if strings.Contains(err.Error(), bad) {
			t.Fatalf("leak %q in %v", bad, err)
		}
	}
	ips := make([]string, MaxDNSAnswers+1)
	for i := range ips {
		ips[i] = "93.184.216.34"
	}
	if _, err := (EndpointPolicy{Resolver: resolverFor("example.com", ips...)}).Approve(context.Background(), "https://example.com"); err == nil {
		t.Fatal("expected answer cap")
	}
}

func TestEndpointPreservesDistinctPathAndEscaping(t *testing.T) {
	p := EndpointPolicy{Resolver: resolverFor("example.com", "93.184.216.34")}
	for _, raw := range []string{"https://EXAMPLE.com:443/v1", "https://EXAMPLE.com:443/v1/", "https://EXAMPLE.com:443/a%2Fb"} {
		a, err := p.Approve(context.Background(), raw)
		if err != nil {
			t.Fatal(err)
		}
		want := strings.Replace(raw, "https://EXAMPLE.com:443", "https://example.com", 1)
		if a.URL().String() != want {
			t.Fatalf("got %q want %q", a.URL(), want)
		}
	}
}

func TestEndpointRejectsAdditionalSpecialUseRanges(t *testing.T) {
	bad := []string{"192.88.99.1", "64:ff9b::1", "64:ff9b:1::1", "100::1", "100:0:0:1::1", "2001::1", "2001:1ff:ffff::1", "2002::1", "2620:4f:8000::1", "3fff::1", "5f00::1", "4000::1"}
	for _, ip := range bad {
		if _, err := (EndpointPolicy{Resolver: resolverFor("example.com", ip)}).Approve(context.Background(), "https://example.com"); err == nil {
			t.Errorf("allowed %s", ip)
		}
	}
}

func TestEndpointAllowsPublicIPv6Allocation(t *testing.T) {
	if _, err := (EndpointPolicy{Resolver: resolverFor("example.com", "2606:4700:4700::1111")}).Approve(context.Background(), "https://example.com"); err != nil {
		t.Fatal(err)
	}
}
