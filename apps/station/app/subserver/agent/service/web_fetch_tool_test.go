package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"testing"
)

func TestValidateOutboundHTTPURLRejectsInternalTargets(t *testing.T) {
	blocked := []string{
		"http://127.0.0.1:8080/health",
		"http://localhost/admin",
		"https://localhost/",
		"https://10.0.0.5/",
		"https://192.168.1.10/",
		"https://172.16.4.4/",
		"https://169.254.169.254/latest/meta-data/",
		"https://[::1]/",
		"https://[fc00::1]/",
		"https://0.0.0.0/",
		"http://example.com/",
		"https://user:pass@example.com/",
		"ftp://example.com/file",
		"",
		"https://example.com/" + string(rune(0x0a)) + "x",
	}
	for _, raw := range blocked {
		if err := validateOutboundHTTPURL(raw, nil); err == nil {
			t.Fatalf("expected %q to be rejected", raw)
		}
	}
}

func TestValidateOutboundHTTPURLAllowsPublicHTTPS(t *testing.T) {
	publicIP := net.ParseIP("93.184.216.34")
	candidates := []string{
		"https://example.com/path?q=1",
		"https://93.184.216.34/file.json",
	}
	for _, raw := range candidates {
		if err := validateOutboundHTTPURL(raw, publicIP); err != nil {
			t.Fatalf("expected %q allowed, got %v", raw, err)
		}
	}
}

func TestValidateOutboundHTTPURLRejectsResolvedPrivateHost(t *testing.T) {
	err := validateOutboundHTTPURL("https://internal.example.com/", net.ParseIP("10.1.2.3"))
	if err == nil {
		t.Fatal("host resolving to private range must be rejected")
	}
}

func TestWebFetchBlocksHostThatOnlyResolvesToPrivateRange(t *testing.T) {
	svc := NewWebFetchService()
	svc.lookupIPs = func(_ context.Context, host string) ([]net.IP, error) {
		if host == "evil.example" {
			return []net.IP{net.ParseIP("10.2.3.4"), net.ParseIP("169.254.1.1")}, nil
		}
		return nil, errors.New("no such host")
	}
	if _, err := svc.Fetch(context.Background(), "https://evil.example/data"); err == nil {
		t.Fatal("fetch must fail when DNS only returns blocked ranges")
	}
}

func TestWebFetchRedirectGuardRejectsInternalHops(t *testing.T) {
	svc := NewWebFetchService()
	redirectTo := func(target string) *http.Request {
		parsed, err := url.Parse(target)
		if err != nil {
			t.Fatalf("parse redirect target: %v", err)
		}
		return &http.Request{URL: parsed}
	}
	cases := []string{
		"http://127.0.0.1/",
		"http://169.254.169.254/latest/meta-data/",
		"https://192.168.0.1/",
	}
	via := []*http.Request{{URL: mustParseURL(t, "https://example.com/start")}}
	for _, target := range cases {
		if err := svc.client.CheckRedirect(redirectTo(target), via); err == nil {
			t.Fatalf("redirect to %q must be rejected", target)
		}
	}
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %s: %v", raw, err)
	}
	return parsed
}
