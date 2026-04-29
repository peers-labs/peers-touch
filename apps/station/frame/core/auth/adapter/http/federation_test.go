package httpadapter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
)

const (
	scopeName    = "test-fed"
	thisStation  = "did:test:station-self"
	otherStation = "did:test:station-other"
	subj         = "did:test:actor"
)

func setupScope(t *testing.T) {
	t.Helper()
	scope.ResetForTest()
	scope.MustRegister(scope.Scope{
		Name: scopeName,
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{"oss_key"},
		},
	})
}

func mintToken(t *testing.T, cache *federation.KeyCache, aud string) string {
	t.Helper()
	tok, err := federation.Mint(context.Background(), cache, federation.MintRequest{
		Scope:    scopeName,
		Issuer:   otherStation,
		Subject:  subj,
		Audience: aud,
		TTL:      30 * time.Second,
		Custom:   map[string]string{"oss_key": "k"},
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	return tok
}

// claimsCapturingHandler stashes the per-request VerifiedClaims
// into a closed-over slot so the test can assert what the
// downstream handler actually saw.
func claimsCapturingHandler(out **federation.VerifiedClaims) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := GetVerifiedClaims(r.Context())
		*out = c
		w.WriteHeader(http.StatusOK)
	})
}

func TestRequireFederationToken_HappyPath(t *testing.T) {
	setupScope(t)
	cache := federation.NewKeyCache(federation.NewInMemoryKeyStore(), federation.WithRecheckTTL(0))
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("warm cache: %v", err)
	}
	peers := federation.NewInMemoryPeerKeyStore()
	tok := mintToken(t, cache, thisStation)

	var captured *federation.VerifiedClaims
	mw := RequireFederationToken(scopeName, peers, StaticAudience(thisStation), false)
	h := mw(context.Background(), claimsCapturingHandler(&captured))

	req := httptest.NewRequest("GET", "/p", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body=%q", rr.Code, rr.Body.String())
	}
	if captured == nil {
		t.Fatalf("expected handler to see verified claims")
	}
	if captured.Issuer != otherStation {
		t.Errorf("iss: %q", captured.Issuer)
	}
	if v, _ := captured.Get("oss_key"); v != "k" {
		t.Errorf("custom claim: %q", v)
	}
}

func TestRequireFederationToken_RejectsMissingHeader(t *testing.T) {
	setupScope(t)
	peers := federation.NewInMemoryPeerKeyStore()
	mw := RequireFederationToken(scopeName, peers, StaticAudience(thisStation), false)
	h := mw(context.Background(), http.NotFoundHandler())

	req := httptest.NewRequest("GET", "/p", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "auth_required") {
		t.Errorf("body: %s", rr.Body.String())
	}
}

func TestRequireFederationToken_RejectsAudienceMismatch(t *testing.T) {
	setupScope(t)
	cache := federation.NewKeyCache(federation.NewInMemoryKeyStore(), federation.WithRecheckTTL(0))
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("warm cache: %v", err)
	}
	peers := federation.NewInMemoryPeerKeyStore()
	// Token minted for a different audience.
	tok := mintToken(t, cache, "did:test:wrong-station")

	mw := RequireFederationToken(scopeName, peers, StaticAudience(thisStation), false)
	h := mw(context.Background(), http.NotFoundHandler())

	req := httptest.NewRequest("GET", "/p", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestRequireFederationToken_NonFederationStrictRejects(t *testing.T) {
	setupScope(t)
	peers := federation.NewInMemoryPeerKeyStore()
	mw := RequireFederationToken(scopeName, peers, StaticAudience(thisStation), false)
	h := mw(context.Background(), http.NotFoundHandler())

	req := httptest.NewRequest("GET", "/p", nil)
	req.Header.Set("Authorization", "Bearer not-a-jwt")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status %d", rr.Code)
	}
}

func TestRequireFederationToken_PassthroughOnNonFederation(t *testing.T) {
	setupScope(t)
	peers := federation.NewInMemoryPeerKeyStore()
	called := false
	mw := RequireFederationToken(scopeName, peers, StaticAudience(thisStation), true)
	h := mw(context.Background(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}))

	// Empty header → passthrough.
	req := httptest.NewRequest("GET", "/p", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if !called {
		t.Fatalf("expected downstream handler to be called on missing header (passthrough)")
	}
	if rr.Code != http.StatusAccepted {
		t.Errorf("status %d", rr.Code)
	}
}

func TestRequireFederationToken_PanicsOnUnregisteredScope(t *testing.T) {
	scope.ResetForTest()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("expected panic on unregistered scope")
		}
	}()
	peers := federation.NewInMemoryPeerKeyStore()
	_ = RequireFederationToken("missing", peers, StaticAudience(thisStation), false)
}
