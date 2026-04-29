package federation

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
)

// FederationTokenType is the value the framework stamps into
// the JOSE `typ` header so receivers can dispatch a federation
// token vs. a subject access JWT in one parse pass before doing
// any crypto work.
const FederationTokenType = "peer+jwt"

// HeaderJWKPEM is the JOSE header field carrying the inline
// PKIX/PEM public key. The receiver hashes this against the
// `kid` header to confirm well-formedness, then TOFU-pins the
// (StationID, Kid, PEM) triple.
const HeaderJWKPEM = "jwk_pem"

// Federation claims live alongside the registered jwt claims
// inside this typed envelope. Scope is mandatory; Custom may be
// nil but never holds standard registered keys (iss/aud/sub/exp
// /iat/jti) — those are passed via the registered fields.
type Claims struct {
	// Scope is the issuance scope the token belongs to. Both
	// the mint and verify paths cross-check it against the
	// scope registry so a token minted under "oss-federation-
	// pull" cannot be silently accepted by a verify wrapper
	// installed for "moments-federation-fetch".
	Scope string `json:"scope"`

	// Custom holds the per-module claim payload (e.g. OSS's
	// `oss_key`). Marshalled into a flat string→string map so
	// the framework does not have to know the per-module
	// shape.
	Custom map[string]string `json:"custom,omitempty"`

	jwt.RegisteredClaims
}

// MintRequest is the parameter envelope for Mint. Every field
// is documented inline because the call site is intentionally
// the only abstraction between business intent and crypto bytes.
type MintRequest struct {
	// Scope is the registered scope name this mint belongs to.
	// Required. Unknown scope -> ErrUnknownScope; TTL > policy
	// max -> ErrTTLExceedsPolicy; Custom claim key not in
	// AllowedClaimKeys -> ErrClaimNotAllowed.
	Scope string

	// Issuer goes into the registered `iss` claim. Typically
	// the local station ID. Mint does not synthesise it; the
	// caller passes the value so this package stays pure.
	Issuer string

	// Audience goes into the registered `aud` claim. Required
	// when Scope.Policy.AudienceRequired is true; ignored
	// downstream when false.
	Audience string

	// Subject goes into the registered `sub` claim. Required
	// because every federation use case to date binds the
	// token to a per-actor identity.
	Subject string

	// TTL is the desired token lifetime. Zero means "use the
	// scope's TTLMax". Values larger than TTLMax produce
	// ErrTTLExceedsPolicy.
	TTL time.Duration

	// Custom is the per-module claim payload. Must satisfy
	// the scope's AllowedClaimKeys policy.
	Custom map[string]string
}

// Validate checks the static parts of a MintRequest before the
// scope policy is consulted. Surfaces clear errors so call sites
// fail fast at construction time rather than during signing.
func (r MintRequest) validate() error {
	if strings.TrimSpace(r.Scope) == "" {
		return errors.New("federation: mint: scope is required")
	}
	if strings.TrimSpace(r.Issuer) == "" {
		return errors.New("federation: mint: issuer is required")
	}
	if strings.TrimSpace(r.Subject) == "" {
		return errors.New("federation: mint: subject is required")
	}
	return nil
}

// Mint signs an Ed25519 JWT according to MintRequest, the scope
// registry's policy, and the cached LocalKey from the supplied
// KeyCache. Returns the compact serialisation suitable for an
// `Authorization: Bearer …` header.
//
// Mint is a free function (rather than a method on a Service)
// because it is purely a function of (request, scope, key) — it
// holds no state of its own. Callers that need a Service shape
// can wrap this trivially; the framework deliberately does not
// pre-build that wrapper to discourage accidental coupling.
func Mint(ctx context.Context, cache *KeyCache, req MintRequest) (string, error) {
	if cache == nil {
		return "", errors.New("federation: mint: nil key cache")
	}
	if err := req.validate(); err != nil {
		return "", err
	}

	s, err := scope.CheckMint(req.Scope, req.Audience, req.TTL, req.Custom)
	if err != nil {
		return "", err
	}
	ttl := scope.EffectiveTTL(s, req.TTL)

	key, err := cache.Get(ctx)
	if err != nil {
		return "", err
	}

	now := time.Now()
	exp := now.Add(ttl)
	jti := tokenID(req.Subject, exp)

	registered := jwt.RegisteredClaims{
		Issuer:    req.Issuer,
		Subject:   req.Subject,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(exp),
		ID:        jti,
	}
	if req.Audience != "" {
		registered.Audience = jwt.ClaimStrings{req.Audience}
	}
	claims := Claims{
		Scope:            req.Scope,
		Custom:           req.Custom,
		RegisteredClaims: registered,
	}

	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	tok.Header["typ"] = FederationTokenType
	tok.Header["kid"] = key.Kid
	tok.Header[HeaderJWKPEM] = key.PubPEM

	signed, err := tok.SignedString(key.Priv)
	if err != nil {
		return "", fmt.Errorf("federation: mint: sign: %w", err)
	}
	return signed, nil
}

// tokenID derives a deterministic JWT `jti` from (subject, exp)
// so a peer that receives the same logical token twice (network
// retry, reverse-proxy buffering) sees a stable replay marker.
// 24 base32 chars of SHA-256 = 120 bits of entropy.
func tokenID(subject string, exp time.Time) string {
	sum := sha256.Sum256([]byte(subject + "|" + exp.UTC().Format(time.RFC3339Nano)))
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum[:])
	if len(enc) > 24 {
		enc = enc[:24]
	}
	return strings.ToLower(enc)
}
