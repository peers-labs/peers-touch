package federation

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
)

const maximumPeerTokenFutureSkew = 5 * time.Second

// VerifiedClaims is what handlers receive after a successful
// Verify. Custom is the per-module claim payload as a flat
// string→string map; modules cast / parse it as needed.
//
// Issuer is exposed as a top-level field (rather than forcing
// callers to dig into Registered.Issuer) because it is the
// single most useful value on the verify path: every audit log
// and every per-module business policy starts with "which peer
// signed this".
type VerifiedClaims struct {
	Scope     string
	Issuer    string
	Audience  string
	Subject   string
	Custom    map[string]string
	IssuedAt  time.Time
	ExpiresAt time.Time

	signingKeyID string
	signingKey   ed25519.PublicKey
}

// Get fetches a custom claim value. Returns ("", false) when
// the key is absent. Provided so call sites read as
// `claims.Get("oss_key")` rather than poking into the map.
func (c VerifiedClaims) Get(key string) (string, bool) {
	if c.Custom == nil {
		return "", false
	}
	v, ok := c.Custom[key]
	return v, ok
}

// SigningKeyID returns the key ID whose Ed25519 signature authenticated this
// request. Capturing it during verification avoids a second mutable-store lookup.
func (c VerifiedClaims) SigningKeyID() string {
	return c.signingKeyID
}

// SigningPublicKey returns a copy of the key that authenticated this request.
func (c VerifiedClaims) SigningPublicKey() ed25519.PublicKey {
	return append(ed25519.PublicKey(nil), c.signingKey...)
}

// ErrNotFederationToken is the sentinel returned when the JOSE
// `typ` header is not the federation marker. Callers that mix
// federation + subject access tokens on the same handler branch
// on this to fall through to the user-JWT path. (The OSS file
// GET handler is the canonical example.)
var ErrNotFederationToken = errors.New("federation: verify: not a peer token")

// Verify parses + validates a federation JWT. Steps:
//
//  1. Peek the header without verifying signature; bail with
//     ErrNotFederationToken if `typ` is wrong (the cheapest
//     dispatch).
//  2. Decode the inline JWK PEM, derive its kid, refuse if it
//     disagrees with the header `kid` (defends against a forged
//     token where the embedded key and claimed kid differ).
//  3. Run TOFU: insert on first sighting, refuse on a kid
//     mismatch (pinned or not).
//  4. Re-parse with the verified public key; jwt/v5 enforces
//     algorithm, exp, iss, aud.
//  5. Cross-check: scope claim must match `expectedScope`;
//     custom claims must obey the scope's AllowedClaimKeys.
//  6. Best-effort TouchLastSeen; failure does not deny.
//
// expectedAudience is required: every consumer is expected to
// know "I am station X" before installing the verify wrapper.
func Verify(
	ctx context.Context,
	store PeerKeyStore,
	bearer, expectedScope, expectedAudience string,
) (*VerifiedClaims, error) {
	if store == nil {
		return nil, errors.New("federation: verify: nil peer key store")
	}
	if strings.TrimSpace(bearer) == "" {
		return nil, ErrNotFederationToken
	}
	if strings.TrimSpace(expectedScope) == "" {
		return nil, errors.New("federation: verify: expectedScope is required")
	}
	if strings.TrimSpace(expectedAudience) == "" {
		return nil, errors.New("federation: verify: expectedAudience is required")
	}

	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}))
	headerKid, headerJWK, peeked, err := peekHeader(parser, bearer)
	if err != nil {
		return nil, err
	}

	pub, derivedKid, err := ParsePeerJWKPEM(headerJWK)
	if err != nil {
		return nil, fmt.Errorf("federation: verify: %w", err)
	}
	if derivedKid != headerKid {
		return nil, errors.New("federation: verify: kid != hash(jwk)")
	}

	if peeked.Issuer == "" {
		return nil, errors.New("federation: verify: missing iss")
	}
	if err := store.UpsertTOFU(ctx, PeerKey{
		StationID: peeked.Issuer,
		Kid:       headerKid,
		PubPEM:    headerJWK,
	}); err != nil {
		return nil, err
	}

	full, err := parseAndVerify(bearer, pub, peeked.Issuer, expectedAudience)
	if err != nil {
		return nil, err
	}

	if full.Scope != expectedScope {
		return nil, fmt.Errorf("federation: verify: scope mismatch: token=%q expected=%q",
			full.Scope, expectedScope)
	}
	if err := validateRegisteredClaims(full, time.Now()); err != nil {
		return nil, err
	}

	// Re-run the scope policy on the inbound side too. This
	// catches a peer that minted with a TTL longer than our
	// local policy permits; we refuse to honour it even if
	// their local registry was looser.
	if _, err := scope.CheckMint(full.Scope, full.audienceSingle(), full.ttl(), full.Custom); err != nil {
		return nil, err
	}

	store.TouchLastSeen(ctx, peeked.Issuer, time.Now())

	return &VerifiedClaims{
		Scope:        full.Scope,
		Issuer:       full.Issuer,
		Audience:     full.audienceSingle(),
		Subject:      full.Subject,
		Custom:       full.Custom,
		IssuedAt:     asTime(full.IssuedAt),
		ExpiresAt:    asTime(full.ExpiresAt),
		signingKeyID: headerKid,
		signingKey:   append(ed25519.PublicKey(nil), pub...),
	}, nil
}

// peekHeader extracts (kid, jwk_pem, registered claims) without
// verifying the signature. Used to discover whether this token
// is a federation token at all and to fetch the JWK before
// signature work.
func peekHeader(parser *jwt.Parser, bearer string) (string, string, *Claims, error) {
	tok, _, err := parser.ParseUnverified(bearer, &Claims{})
	if err != nil {
		return "", "", nil, err
	}
	if t, _ := tok.Header["typ"].(string); t != FederationTokenType {
		return "", "", nil, ErrNotFederationToken
	}
	kid, _ := tok.Header["kid"].(string)
	jwk, _ := tok.Header[HeaderJWKPEM].(string)
	if kid == "" || jwk == "" {
		return "", "", nil, errors.New("federation: verify: missing kid/jwk")
	}
	c, ok := tok.Claims.(*Claims)
	if !ok {
		return "", "", nil, errors.New("federation: verify: claim shape unexpected")
	}
	return kid, jwk, c, nil
}

func parseAndVerify(
	bearer string,
	pub ed25519.PublicKey,
	issuer, audience string,
) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(bearer, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return pub, nil
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	c, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, errors.New("federation: verify: claim shape unexpected after parse")
	}
	return c, nil
}

func validateRegisteredClaims(claims *Claims, now time.Time) error {
	if claims == nil {
		return errors.New("federation: verify: registered claims are required")
	}
	if len(claims.Audience) != 1 {
		return errors.New("federation: verify: exactly one audience is required")
	}
	if claims.IssuedAt == nil {
		return errors.New("federation: verify: iat is required")
	}
	if claims.ExpiresAt == nil {
		return errors.New("federation: verify: exp is required")
	}
	issuedAt := claims.IssuedAt.Time
	expiresAt := claims.ExpiresAt.Time
	if issuedAt.After(now.Add(maximumPeerTokenFutureSkew)) {
		return errors.New("federation: verify: iat exceeds allowed future skew")
	}
	if !expiresAt.After(issuedAt) {
		return errors.New("federation: verify: token TTL must be positive")
	}
	if !expiresAt.After(now) {
		return errors.New("federation: verify: token is expired")
	}

	return nil
}

func (c *Claims) audienceSingle() string {
	if len(c.Audience) != 1 {
		return ""
	}
	return c.Audience[0]
}

func (c *Claims) ttl() time.Duration {
	if c.ExpiresAt == nil || c.IssuedAt == nil {
		return 0
	}

	return c.ExpiresAt.Sub(c.IssuedAt.Time)
}

func asTime(n *jwt.NumericDate) time.Time {
	if n == nil {
		return time.Time{}
	}
	return n.Time
}
