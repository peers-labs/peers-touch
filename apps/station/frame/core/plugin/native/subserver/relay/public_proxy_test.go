package relay

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestRelayPublicProxyPreservesHostAndReplacesForwardingHeaders(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			_, _ = fmt.Fprintf(
				response,
				"%s|%s|%s",
				request.Host,
				request.Header.Get("X-Forwarded-For"),
				request.Header.Get("X-Forwarded-Proto"),
			)
		},
	))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatalf("parse upstream: %v", err)
	}
	public := httptest.NewServer(newRelayPublicProxy(target))
	defer public.Close()

	request, err := http.NewRequest(http.MethodGet, public.URL+"/healthz", nil)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Host = "relay.example.test:18443"
	request.Header.Set("X-Forwarded-For", "203.0.113.99")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("request public proxy: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	parts := strings.Split(string(body), "|")
	if len(parts) != 3 {
		t.Fatalf("unexpected proxy response: %q", body)
	}
	if parts[0] != "relay.example.test:18443" {
		t.Fatalf("forwarded host = %q", parts[0])
	}
	if parts[1] == "203.0.113.99" || parts[1] == "" {
		t.Fatalf("forwarded source was spoofed or omitted: %q", parts[1])
	}
	if parts[2] != "https" {
		t.Fatalf("forwarded protocol = %q", parts[2])
	}
}
