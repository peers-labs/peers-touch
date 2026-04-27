package oss

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base32"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
)

// Federation token shape
// ---------------------------------------------------------------
//
// The OSS subserver issues short-lived (≤60s) Ed25519 JWTs that
// authorise *one specific peer station* to fetch *one specific
// object* on behalf of *one specific actor*. The shape is:
//
//   header:
//     alg = EdDSA
//     typ = peer+jwt           // distinguishes from user HS256 JWTs
//     kid = <our station's KID>
//     jwk = <our station's PUBLIC key, JWK form>   // first-use TOFU
//
//   claims (registered + custom):
//     iss = <our station id>   // the minter
//     aud = <peer station id>  // the receiver
//     sub = <actor DID>        // the on-behalf-of identity
//     exp = now + ≤60s
//     iat = now
//     jti = sha256(file_key|exp)[:24]   // replay marker
//
//     oss_key = <file_key>     // the single object this token authorises
//
// Why three identity fields (iss/aud/sub)? Because all three are
// needed for the receiving station to make a permission decision:
// it must verify the token's *signature* (iss), confirm the token
// was minted *for it* (aud), and know *whose audience claim* to
// project onto checkRead's `peerSubjectID` arg (sub).
//
// Why bind exactly one object? A "session token" that authorises
// the bearer to fetch any of station A's files would let one
// compromised peer station exfiltrate everything visible to a
// single chat-attached file. Per-object minimises blast radius.

// federationTokenType is the value we set in the JOSE `typ` header
// to distinguish federation JWTs from the existing HS256 user JWTs.
// The receiver's verifier dispatches on this string before doing
// any signature work.
const federationTokenType = "peer+jwt"

// federationMaxTTL is the upper bound enforced by both Mint (clamps
// down) and Verify (rejects above). 60s is short enough that
// replay attacks have a tiny window, long enough that a slow
// federated GET will not race the expiry.
const federationMaxTTL = 60 * time.Second

// federationKey is the in-memory cache of the local Ed25519 keypair
// plus the fingerprint we publish as `kid`. The struct is loaded
// (or generated and persisted) on first call to ensureLocalKey.
type federationKey struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
	kid  string
	pem  string // public PEM; cached for JWK header generation
}

// federationKeyCache lazily loads the keypair from oss_meta on first
// use, then keeps it in memory for the lifetime of the subserver.
// Concurrent callers race only on the first load — once present,
// reads are lock-free.
type federationKeyCache struct {
	repo ossrepo.PeerKeyRepository

	once sync.Once
	mu   sync.RWMutex
	key  *federationKey
	err  error
}

func newFederationKeyCache(repo ossrepo.PeerKeyRepository) *federationKeyCache {
	return &federationKeyCache{repo: repo}
}

// get returns the cached key, loading-or-generating it on first
// call. Errors from the load path are sticky: a KV outage at boot
// should not be silently retried on every mint.
func (c *federationKeyCache) get(ctx context.Context) (*federationKey, error) {
	c.once.Do(func() {
		k, err := c.loadOrGenerate(ctx)
		c.mu.Lock()
		c.key, c.err = k, err
		c.mu.Unlock()
	})
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.key, c.err
}

func (c *federationKeyCache) loadOrGenerate(ctx context.Context) (*federationKey, error) {
	priv, pub, kid, err := c.repo.LoadLocalKey(ctx)
	if err == nil {
		k, perr := parseFederationKey(priv, pub, kid)
		if perr == nil {
			return k, nil
		}
		// Stored bytes are corrupt — refuse to overwrite silently.
		// An operator must intervene; pretending a fresh generation
		// is safe here would silently invalidate every previously
		// minted token still in flight.
		return nil, fmt.Errorf("oss: federation: stored key parse failed: %w", perr)
	}
	if !errors.Is(err, ossrepo.ErrNoLocalKey) {
		return nil, err
	}

	pubR, privR, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("oss: federation: ed25519 generate: %w", err)
	}
	privPEM, pubPEM, kidStr, err := encodeFederationKey(privR, pubR)
	if err != nil {
		return nil, err
	}
	if err := c.repo.SaveLocalKey(ctx, privPEM, pubPEM, kidStr); err != nil {
		return nil, fmt.Errorf("oss: federation: save key: %w", err)
	}
	return &federationKey{priv: privR, pub: pubR, kid: kidStr, pem: pubPEM}, nil
}

// encodeFederationKey marshals an Ed25519 keypair to the on-disk
// PEM shape we persist in oss_meta. The KID is the base32-nopad
// SHA-256 of the SubjectPublicKeyInfo (PKIX) bytes, truncated to
// 26 chars — same compactness as a base32 ULID, plenty of entropy.
func encodeFederationKey(priv ed25519.PrivateKey, pub ed25519.PublicKey) (privPEM, pubPEM, kid string, err error) {
	privDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return "", "", "", err
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", "", "", err
	}
	privPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER}))
	pubPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}))
	sum := sha256.Sum256(pubDER)
	kid = strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum[:]))[:26]
	return privPEM, pubPEM, kid, nil
}

// parseFederationKey is the inverse of encodeFederationKey, used on
// every restart to rehydrate the in-memory cache from oss_meta.
func parseFederationKey(privPEM, pubPEM, kid string) (*federationKey, error) {
	privBlk, _ := pem.Decode([]byte(privPEM))
	if privBlk == nil {
		return nil, errors.New("oss: federation: private pem decode failed")
	}
	privAny, err := x509.ParsePKCS8PrivateKey(privBlk.Bytes)
	if err != nil {
		return nil, err
	}
	priv, ok := privAny.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("oss: federation: private key is not ed25519")
	}
	pubBlk, _ := pem.Decode([]byte(pubPEM))
	if pubBlk == nil {
		return nil, errors.New("oss: federation: public pem decode failed")
	}
	pubAny, err := x509.ParsePKIXPublicKey(pubBlk.Bytes)
	if err != nil {
		return nil, err
	}
	pub, ok := pubAny.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("oss: federation: public key is not ed25519")
	}
	if kid == "" {
		return nil, errors.New("oss: federation: missing kid")
	}
	return &federationKey{priv: priv, pub: pub, kid: kid, pem: pubPEM}, nil
}

// peerTokenClaims is the typed claim envelope serialised into the
// JWT payload. Embedding RegisteredClaims gives us iss/aud/sub/exp
// validation via the jwt/v5 library; OSSKey is our one custom
// claim binding the token to a single object.
type peerTokenClaims struct {
	OSSKey string `json:"oss_key"`
	jwt.RegisteredClaims
}

// MintRequest is the parameter envelope for MintPeerToken. The
// struct shape is what the friend_chat outbox (the future caller)
// will fill in when forwarding an attachment to a peer station.
type MintPeerTokenRequest struct {
	// LocalStationID is the value to set as the `iss` claim. The
	// caller supplies it (rather than us reading it from the node
	// service) so this function stays a pure crypto helper —
	// testable without a running node.
	LocalStationID string

	// PeerStationID is the `aud` claim — the receiving station.
	PeerStationID string

	// ActorDID is the `sub` claim — the identity *on the peer
	// station* the receiver should project into checkRead.
	ActorDID string

	// FileKey is the single object this token authorises.
	FileKey string

	// TTL is clamped to federationMaxTTL. Zero means "use max".
	TTL time.Duration
}

// MintPeerToken signs a per-object federation JWT. Returns the
// compact serialisation suitable for an `Authorization: Bearer …`
// header.
func (s *ossSubServer) MintPeerToken(ctx context.Context, req MintPeerTokenRequest) (string, error) {
	if req.LocalStationID == "" || req.PeerStationID == "" || req.ActorDID == "" || req.FileKey == "" {
		return "", errors.New("oss: federation: mint: missing required field")
	}
	if s.fedKeys == nil {
		return "", errors.New("oss: federation: mint: key cache not initialised")
	}
	key, err := s.fedKeys.get(ctx)
	if err != nil {
		return "", err
	}

	ttl := req.TTL
	if ttl <= 0 || ttl > federationMaxTTL {
		ttl = federationMaxTTL
	}
	now := time.Now()
	exp := now.Add(ttl)
	jti := sha256.Sum256([]byte(req.FileKey + "|" + exp.UTC().Format(time.RFC3339Nano)))

	claims := peerTokenClaims{
		OSSKey: req.FileKey,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    req.LocalStationID,
			Audience:  jwt.ClaimStrings{req.PeerStationID},
			Subject:   req.ActorDID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			ID:        strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(jti[:]))[:24],
		},
	}

	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	tok.Header["typ"] = federationTokenType
	tok.Header["kid"] = key.kid
	// Inline the public key (PEM) on every token. This is the TOFU
	// payload: the receiver hashes it to confirm the kid, and on
	// first sighting persists it to oss_peer_keys. Embedding it
	// every time keeps the protocol stateless from the minter's
	// side — there is no out-of-band key-publication endpoint.
	tok.Header["jwk_pem"] = key.pem

	signed, err := tok.SignedString(key.priv)
	if err != nil {
		return "", err
	}
	return signed, nil
}

// VerifyPeerTokenResult is what handleFileGet receives after a
// successful verify. The decision logic on the read path then
// projects ActorDID into checkRead's peerSubjectID arg.
type VerifyPeerTokenResult struct {
	ActorDID      string
	PeerStationID string
	OSSKey        string
}

// VerifyPeerToken is the read-path entry point. It pulls the bearer
// token off the request header, dispatches on the JOSE `typ`, and
// verifies the signature against the cached (or just-TOFU'd) peer
// public key. Returns ErrNotFederationToken if `typ` is not the
// federation marker — callers fall through to the local user-JWT
// path.
func (s *ossSubServer) VerifyPeerToken(ctx context.Context, bearer, expectedFileKey, ourStationID string) (*VerifyPeerTokenResult, error) {
	if s.peerKeyRepo == nil {
		return nil, errors.New("oss: federation: verify: peer key repo not wired")
	}
	if bearer == "" {
		return nil, ErrNotFederationToken
	}

	// Parse without verifying first — we need the header to decide
	// whether this is even a federation token, and to fetch the
	// JWK before verifying the signature.
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}))
	header, claims, err := peekPeerTokenHeader(parser, bearer)
	if err != nil {
		return nil, err
	}
	if t, _ := header["typ"].(string); t != federationTokenType {
		return nil, ErrNotFederationToken
	}

	kid, _ := header["kid"].(string)
	jwkPEM, _ := header["jwk_pem"].(string)
	if kid == "" || jwkPEM == "" {
		return nil, errors.New("oss: federation: verify: missing kid/jwk")
	}

	// Confirm kid matches the embedded public key. A kid that
	// disagrees with its own JWK is either malformed or actively
	// trying to bypass the TOFU comparison — refuse early.
	pub, derivedKID, err := decodeJWKPEM(jwkPEM)
	if err != nil {
		return nil, fmt.Errorf("oss: federation: verify: jwk decode: %w", err)
	}
	if derivedKID != kid {
		return nil, errors.New("oss: federation: verify: kid != hash(jwk)")
	}

	if claims.Issuer == "" {
		return nil, errors.New("oss: federation: verify: missing iss")
	}
	if err := s.peerKeyRepo.UpsertTOFU(ctx, ossmodel.PeerKey{
		PeerStationID: claims.Issuer,
		KID:           kid,
		PublicKeyPEM:  jwkPEM,
	}); err != nil {
		return nil, err
	}

	// Now do the real signature verification — the JWK was hashed
	// against kid above, so trusting it for one parse is safe.
	tok, err := jwt.ParseWithClaims(bearer, &peerTokenClaims{}, func(t *jwt.Token) (interface{}, error) {
		return pub, nil
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithAudience(ourStationID),
		jwt.WithIssuer(claims.Issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	full, ok := tok.Claims.(*peerTokenClaims)
	if !ok || !tok.Valid {
		return nil, errors.New("oss: federation: verify: invalid claims")
	}

	if full.OSSKey != expectedFileKey {
		return nil, errors.New("oss: federation: verify: oss_key mismatch")
	}
	if full.ExpiresAt == nil || time.Until(full.ExpiresAt.Time) > federationMaxTTL+5*time.Second {
		// Tokens minted with a TTL longer than our policy ceiling
		// (allowing a tiny clock-skew margin) are rejected. This
		// defends against a misconfigured peer that sets a 1-day
		// expiry — replay window must stay short.
		return nil, errors.New("oss: federation: verify: ttl exceeds policy")
	}

	s.peerKeyRepo.TouchLastSeen(ctx, claims.Issuer, time.Now())

	return &VerifyPeerTokenResult{
		ActorDID:      full.Subject,
		PeerStationID: full.Issuer,
		OSSKey:        full.OSSKey,
	}, nil
}

// ErrNotFederationToken is the sentinel returned by VerifyPeerToken
// when the bearer is well-formed JWT but is not typed as a peer
// token — handleFileGet branches on this error to fall through to
// the local user-JWT path.
var ErrNotFederationToken = errors.New("oss: federation: not a peer token")

// peekPeerTokenHeader parses the JWT structure to expose its
// header + (unverified) registered claims. This is the standard
// "look at the typ before doing crypto" trick the jwt/v5 library
// supports via ParseUnverified. We never trust the returned claims
// directly — they are re-verified after we pull the JWK out.
func peekPeerTokenHeader(parser *jwt.Parser, bearer string) (map[string]any, *jwt.RegisteredClaims, error) {
	tok, _, err := parser.ParseUnverified(bearer, &peerTokenClaims{})
	if err != nil {
		return nil, nil, err
	}
	pc, ok := tok.Claims.(*peerTokenClaims)
	if !ok {
		return nil, nil, errors.New("oss: federation: peek: claim shape unexpected")
	}
	return tok.Header, &pc.RegisteredClaims, nil
}

// decodeJWKPEM parses the inline-JWK PEM and computes its KID via
// the same encoding rule encodeFederationKey uses. It is the only
// codepath through which a *remote* public key enters the system,
// so the parsing is intentionally strict about the algorithm.
func decodeJWKPEM(pemStr string) (ed25519.PublicKey, string, error) {
	blk, _ := pem.Decode([]byte(pemStr))
	if blk == nil {
		return nil, "", errors.New("pem decode failed")
	}
	pubAny, err := x509.ParsePKIXPublicKey(blk.Bytes)
	if err != nil {
		return nil, "", err
	}
	pub, ok := pubAny.(ed25519.PublicKey)
	if !ok {
		return nil, "", errors.New("public key is not ed25519")
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(pubDER)
	kid := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum[:]))[:26]
	return pub, kid, nil
}
