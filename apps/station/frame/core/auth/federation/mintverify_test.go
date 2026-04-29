package federation

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
)

const (
	testScope = "test-scope"
	testIss   = "did:test:station-A"
	testAud   = "did:test:station-B"
	testSub   = "did:test:actor-alice"
)

// scopeFixture re-arms the scope registry with one well-formed
// scope. Tests call this from their setup so the registry state
// is deterministic regardless of test order.
func scopeFixture(t *testing.T) {
	t.Helper()
	scope.ResetForTest()
	scope.MustRegister(scope.Scope{
		Name:        testScope,
		Description: "round-trip fixture",
		Policy: scope.Policy{
			TTLMax:           time.Minute,
			AudienceRequired: true,
			AllowedClaimKeys: []string{"oss_key"},
		},
	})
}

func newCacheWithFreshKey(t *testing.T) (*KeyCache, *InMemoryKeyStore) {
	t.Helper()
	store := NewInMemoryKeyStore()
	cache := NewKeyCache(store, WithRecheckTTL(0))
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("warm cache: %v", err)
	}
	return cache, store
}

// ---- Mint ------------------------------------------------------------------

func TestMint_RejectsWithoutScope(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	_, err := Mint(context.Background(), cache, MintRequest{
		Issuer: testIss, Subject: testSub, Audience: testAud,
		Custom: map[string]string{"oss_key": "k"},
	})
	if err == nil || !strings.Contains(err.Error(), "scope is required") {
		t.Fatalf("expected scope-required error, got %v", err)
	}
}

func TestMint_RejectsUnknownScope(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	_, err := Mint(context.Background(), cache, MintRequest{
		Scope: "missing", Issuer: testIss, Subject: testSub, Audience: testAud,
	})
	if !errors.Is(err, scope.ErrUnknownScope) {
		t.Fatalf("expected ErrUnknownScope, got %v", err)
	}
}

func TestMint_RejectsTTLOverflow(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	_, err := Mint(context.Background(), cache, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub, Audience: testAud,
		TTL: time.Hour, Custom: map[string]string{"oss_key": "k"},
	})
	if !errors.Is(err, scope.ErrTTLExceedsPolicy) {
		t.Fatalf("expected ErrTTLExceedsPolicy, got %v", err)
	}
}

func TestMint_RejectsMissingAudienceWhenRequired(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	_, err := Mint(context.Background(), cache, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub,
		Custom: map[string]string{"oss_key": "k"},
	})
	if !errors.Is(err, scope.ErrAudienceRequired) {
		t.Fatalf("expected ErrAudienceRequired, got %v", err)
	}
}

func TestMint_RejectsDisallowedCustomClaim(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	_, err := Mint(context.Background(), cache, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub, Audience: testAud,
		Custom: map[string]string{"hidden": "x"},
	})
	if !errors.Is(err, scope.ErrClaimNotAllowed) {
		t.Fatalf("expected ErrClaimNotAllowed, got %v", err)
	}
}

func TestMint_HappyPathReturnsParseableJWT(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	tok, err := Mint(context.Background(), cache, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub, Audience: testAud,
		TTL: 30 * time.Second, Custom: map[string]string{"oss_key": "k"},
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if tok == "" {
		t.Fatalf("empty token")
	}
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}))
	parsed, _, err := parser.ParseUnverified(tok, &Claims{})
	if err != nil {
		t.Fatalf("re-parse unverified: %v", err)
	}
	if typ, _ := parsed.Header["typ"].(string); typ != FederationTokenType {
		t.Errorf("typ header: %q", typ)
	}
	if kid, _ := parsed.Header["kid"].(string); kid == "" {
		t.Errorf("missing kid header")
	}
	if jwk, _ := parsed.Header[HeaderJWKPEM].(string); !strings.Contains(jwk, "BEGIN PUBLIC KEY") {
		t.Errorf("missing or malformed jwk_pem header")
	}
}

// ---- Verify ----------------------------------------------------------------

func TestVerify_HappyRoundTrip(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	peers := NewInMemoryPeerKeyStore()

	tok, err := Mint(context.Background(), cache, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub, Audience: testAud,
		TTL: 30 * time.Second, Custom: map[string]string{"oss_key": "k"},
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	got, err := Verify(context.Background(), peers, tok, testScope, testAud)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got.Scope != testScope {
		t.Errorf("scope: %q", got.Scope)
	}
	if got.Issuer != testIss {
		t.Errorf("iss: %q", got.Issuer)
	}
	if got.Audience != testAud {
		t.Errorf("aud: %q", got.Audience)
	}
	if got.Subject != testSub {
		t.Errorf("sub: %q", got.Subject)
	}
	if v, ok := got.Get("oss_key"); !ok || v != "k" {
		t.Errorf("custom oss_key: %q ok=%v", v, ok)
	}

	row, _ := peers.Get(context.Background(), testIss)
	if row == nil {
		t.Fatalf("expected TOFU row inserted")
	}
}

func TestVerify_DispatchesNonFederationToken(t *testing.T) {
	scopeFixture(t)
	peers := NewInMemoryPeerKeyStore()
	// Build a HS256 token (subject access shape), not federation.
	c := jwt.RegisteredClaims{
		Issuer:    testIss,
		Subject:   testSub,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte("secret"))
	if err != nil {
		t.Fatalf("hs256: %v", err)
	}
	_, err = Verify(context.Background(), peers, tok, testScope, testAud)
	if !errors.Is(err, ErrNotFederationToken) {
		t.Fatalf("expected ErrNotFederationToken, got %v", err)
	}
}

func TestVerify_RejectsAudienceMismatch(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	peers := NewInMemoryPeerKeyStore()

	tok, err := Mint(context.Background(), cache, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub, Audience: testAud,
		TTL: 30 * time.Second, Custom: map[string]string{"oss_key": "k"},
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	_, err = Verify(context.Background(), peers, tok, testScope, "did:test:other")
	if err == nil {
		t.Fatalf("expected aud-mismatch error")
	}
}

func TestVerify_RejectsScopeMismatch(t *testing.T) {
	scopeFixture(t)
	scope.MustRegister(scope.Scope{
		Name:   "other-scope",
		Policy: scope.Policy{TTLMax: time.Minute, AudienceRequired: true, AllowedClaimKeys: []string{"oss_key"}},
	})
	cache, _ := newCacheWithFreshKey(t)
	peers := NewInMemoryPeerKeyStore()

	tok, err := Mint(context.Background(), cache, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub, Audience: testAud,
		TTL: 30 * time.Second, Custom: map[string]string{"oss_key": "k"},
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	_, err = Verify(context.Background(), peers, tok, "other-scope", testAud)
	if err == nil || !strings.Contains(err.Error(), "scope mismatch") {
		t.Fatalf("expected scope-mismatch error, got %v", err)
	}
}

func TestVerify_TOFUKidMismatchRejects(t *testing.T) {
	scopeFixture(t)
	cache1, _ := newCacheWithFreshKey(t)
	peers := NewInMemoryPeerKeyStore()

	tok1, err := Mint(context.Background(), cache1, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub, Audience: testAud,
		TTL: 30 * time.Second, Custom: map[string]string{"oss_key": "k"},
	})
	if err != nil {
		t.Fatalf("mint1: %v", err)
	}
	if _, err := Verify(context.Background(), peers, tok1, testScope, testAud); err != nil {
		t.Fatalf("verify1: %v", err)
	}

	// New cache = new keypair = new kid for the same iss.
	cache2, _ := newCacheWithFreshKey(t)
	tok2, err := Mint(context.Background(), cache2, MintRequest{
		Scope: testScope, Issuer: testIss, Subject: testSub, Audience: testAud,
		TTL: 30 * time.Second, Custom: map[string]string{"oss_key": "k"},
	})
	if err != nil {
		t.Fatalf("mint2: %v", err)
	}
	_, err = Verify(context.Background(), peers, tok2, testScope, testAud)
	if !errors.Is(err, ErrPeerKeyMismatch) {
		t.Fatalf("expected ErrPeerKeyMismatch, got %v", err)
	}
}

func TestVerify_RejectsExpiredToken(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	peers := NewInMemoryPeerKeyStore()
	key, _ := cache.Get(context.Background())

	now := time.Now().Add(-2 * time.Minute)
	exp := now.Add(time.Second) // expired one minute fifty-nine seconds ago
	registered := jwt.RegisteredClaims{
		Issuer:    testIss,
		Subject:   testSub,
		Audience:  jwt.ClaimStrings{testAud},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(exp),
	}
	c := Claims{Scope: testScope, Custom: map[string]string{"oss_key": "k"}, RegisteredClaims: registered}
	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, c)
	tok.Header["typ"] = FederationTokenType
	tok.Header["kid"] = key.Kid
	tok.Header[HeaderJWKPEM] = key.PubPEM
	signed, err := tok.SignedString(key.Priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	_, err = Verify(context.Background(), peers, signed, testScope, testAud)
	if err == nil {
		t.Fatalf("expected expired-token rejection")
	}
}

func TestVerify_RejectsInboundOversizedTTL(t *testing.T) {
	scopeFixture(t)
	cache, _ := newCacheWithFreshKey(t)
	peers := NewInMemoryPeerKeyStore()
	key, _ := cache.Get(context.Background())

	// Mint manually with a 2-minute TTL — outside the test
	// scope's 1-minute policy. Verify should still reject even
	// though it round-trips signature OK.
	now := time.Now()
	exp := now.Add(2 * time.Minute)
	registered := jwt.RegisteredClaims{
		Issuer:    testIss,
		Subject:   testSub,
		Audience:  jwt.ClaimStrings{testAud},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(exp),
	}
	c := Claims{Scope: testScope, Custom: map[string]string{"oss_key": "k"}, RegisteredClaims: registered}
	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, c)
	tok.Header["typ"] = FederationTokenType
	tok.Header["kid"] = key.Kid
	tok.Header[HeaderJWKPEM] = key.PubPEM
	signed, _ := tok.SignedString(key.Priv)

	_, err := Verify(context.Background(), peers, signed, testScope, testAud)
	if !errors.Is(err, scope.ErrTTLExceedsPolicy) {
		t.Fatalf("expected ErrTTLExceedsPolicy on inbound, got %v", err)
	}
}
