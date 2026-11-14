package sandbox

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// The Station client must present the configured bearer secret on every /v1
// call, and omit the header entirely when no secret is configured (dev cell).
func TestHTTPClientBearerToken(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	withToken := NewHTTPClient(srv.URL, 5*time.Second).WithBearerToken("s3cr3t")
	if err := withToken.postJSON(context.Background(), "/v1/sandboxes/reconcile", map[string]any{}, nil); err != nil {
		t.Fatalf("post: %v", err)
	}
	if gotAuth != "Bearer s3cr3t" {
		t.Fatalf("auth header=%q, want Bearer s3cr3t", gotAuth)
	}

	gotAuth = ""
	noToken := NewHTTPClient(srv.URL, 5*time.Second)
	if err := noToken.postJSON(context.Background(), "/v1/sandboxes/reconcile", map[string]any{}, nil); err != nil {
		t.Fatalf("post: %v", err)
	}
	if gotAuth != "" {
		t.Fatalf("expected no Authorization header without a token, got %q", gotAuth)
	}
}

// A 401 from the provisioner surfaces as an error so Station fails closed
// rather than treating a rejected call as a successful no-op.
func TestHTTPClientRejectsUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := NewHTTPClient(srv.URL, 5*time.Second).WithBearerToken("wrong")
	err := c.postJSON(context.Background(), "/v1/sandboxes/reconcile", map[string]any{}, nil)
	if err == nil {
		t.Fatal("401 must be returned as an error")
	}
}
