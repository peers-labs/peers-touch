package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlerBootstrapFailureHasAdminSecurityHeaders(t *testing.T) {
	t.Setenv("OAUTH_SITES_JSON", "[]")
	recorder := httptest.NewRecorder()
	Handler(recorder, httptest.NewRequest(http.MethodGet, "https://broker.example/api/admin", nil))
	response := recorder.Result()
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected service unavailable, got %d", response.StatusCode)
	}
	assertBootstrapFailureHeaders(t, response.Header)
}

func assertBootstrapFailureHeaders(t *testing.T, header http.Header) {
	t.Helper()
	for name, expected := range map[string]string{
		"Cache-Control":           "no-store",
		"Content-Security-Policy": "frame-ancestors 'none'",
		"Referrer-Policy":         "no-referrer",
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"X-Robots-Tag":            "noindex, nofollow",
	} {
		if actual := header.Get(name); actual != expected &&
			(name != "Content-Security-Policy" || !strings.Contains(actual, expected)) {
			t.Fatalf("%s = %q, want %q", name, actual, expected)
		}
	}
}
