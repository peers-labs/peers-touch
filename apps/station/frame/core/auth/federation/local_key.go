package federation

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base32"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"
)

// kidByteLen is the truncated length of the SHA-256 digest we
// publish as the kid. 26 base32-nopad characters = 130 bits of
// entropy — well above any practical collision boundary, and
// short enough to fit in a JOSE header without overflowing the
// per-line size limit some HTTP/1.1 servers enforce on bearer
// tokens.
const kidByteLen = 26

// LocalKey is the in-memory shape of this station's signing
// keypair. The public fields are intentionally exported because
// the dashboard's federation-key endpoint serves them verbatim
// over JSON; the private key is held as opaque ed25519.PrivateKey
// bytes so accidental marshalling cannot leak it.
//
// LocalKey is value-typed (not interface) because there is only
// one shape of station signing key in the system — keeping it
// concrete avoids a layer of method dispatch on the mint hot path.
type LocalKey struct {
	// Kid is the SHA-256 fingerprint of PubPEM, base32-nopad
	// truncated to 26 chars. Receivers TOFU on (StationID, Kid).
	Kid string

	// Priv is the parsed Ed25519 private key. Zero-valued on
	// any LocalKey returned out of LoadPublic — callers must
	// not assume Priv is populated.
	Priv ed25519.PrivateKey

	// Pub is the parsed Ed25519 public key.
	Pub ed25519.PublicKey

	// PrivPEM is the PKCS#8 PEM encoding of Priv. Persisted
	// verbatim in the KeyStore.
	PrivPEM string

	// PubPEM is the PKIX PEM encoding of Pub. Persisted
	// verbatim, AND embedded in the JOSE header of every minted
	// token (the TOFU payload).
	PubPEM string

	// GeneratedAt is the wall-clock at which the key was
	// freshly generated. Useful for the dashboard "key age"
	// surface and for the rotation finalizer.
	GeneratedAt time.Time

	// UpdatedAt is the persisted slot-transition time. For the
	// previous slot this is the rotation time that starts the
	// bounded dual-sign grace window.
	UpdatedAt time.Time
}

// IsZero reports whether the LocalKey is the empty value. Used
// by KeyCache.get to decide whether the persisted slot is
// populated without depending on a nullable shape.
func (k LocalKey) IsZero() bool {
	return k.Kid == "" && len(k.Priv) == 0 && len(k.Pub) == 0
}

// MintLocalKey generates a fresh Ed25519 keypair, derives its
// kid, and returns a fully-populated LocalKey. Callers persist
// it via KeyStore.PutCurrent (or KeyStore.Rotate) — Mint by
// itself never touches storage.
//
// The function is named "Mint" rather than "Generate" to mirror
// the Mint() entry on the federation token API: both produce a
// new artefact from entropy. Tests that need deterministic kids
// pass a custom rand.Reader via crypto/rand swapping at the
// process level (no API hook here).
func MintLocalKey(now time.Time) (*LocalKey, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("federation: ed25519 generate: %w", err)
	}
	privPEM, pubPEM, kid, err := encodeLocalKey(priv, pub)
	if err != nil {
		return nil, err
	}
	return &LocalKey{
		Kid:         kid,
		Priv:        priv,
		Pub:         pub,
		PrivPEM:     privPEM,
		PubPEM:      pubPEM,
		GeneratedAt: now,
	}, nil
}

// encodeLocalKey marshals an Ed25519 keypair to the on-disk PEM
// shape we persist. The KID is the base32-nopad SHA-256 of the
// SubjectPublicKeyInfo (PKIX) bytes, truncated to 26 chars.
func encodeLocalKey(priv ed25519.PrivateKey, pub ed25519.PublicKey) (privPEM, pubPEM, kid string, err error) {
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
	kid = KidFromPubDER(pubDER)
	return privPEM, pubPEM, kid, nil
}

// KidFromPubDER computes the canonical KID from a PKIX-encoded
// Ed25519 public key. Exposed publicly because both the local
// keypair generator and the inbound JWK-header decoder need to
// produce the *exact same* kid for a given public key — they
// must share one implementation, full stop.
func KidFromPubDER(pubDER []byte) string {
	sum := sha256.Sum256(pubDER)
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum[:])
	if len(enc) > kidByteLen {
		enc = enc[:kidByteLen]
	}
	return strings.ToLower(enc)
}

// ParseLocalKey is the inverse of encodeLocalKey, used on every
// restart to rehydrate a LocalKey from KeyStore. Strict: a
// PEM/DER mismatch, a non-Ed25519 key, or a missing kid all
// produce errors so a corrupt row cannot be silently accepted.
func ParseLocalKey(privPEM, pubPEM, kid string, generatedAt time.Time) (*LocalKey, error) {
	if privPEM == "" || pubPEM == "" || kid == "" {
		return nil, errors.New("federation: parse: empty fields")
	}
	priv, err := parsePrivPEM(privPEM)
	if err != nil {
		return nil, err
	}
	pub, err := parsePubPEM(pubPEM)
	if err != nil {
		return nil, err
	}
	return &LocalKey{
		Kid:         kid,
		Priv:        priv,
		Pub:         pub,
		PrivPEM:     privPEM,
		PubPEM:      pubPEM,
		GeneratedAt: generatedAt,
	}, nil
}

// ParsePeerJWKPEM is the receiver-side counterpart: parse a peer
// station's public key out of a JOSE header (where it is inlined
// as PEM text), and return the raw key plus the canonical kid we
// should compare against the header's `kid`. Returning the kid
// alongside the key forces the caller to check that the peer's
// claimed kid agrees with hash(jwk) — there is no codepath where
// you legitimately want one but not the other.
func ParsePeerJWKPEM(pemStr string) (ed25519.PublicKey, string, error) {
	if pemStr == "" {
		return nil, "", errors.New("federation: jwk: empty PEM")
	}
	pub, err := parsePubPEM(pemStr)
	if err != nil {
		return nil, "", err
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return nil, "", err
	}
	return pub, KidFromPubDER(pubDER), nil
}

// parsePrivPEM and parsePubPEM are the strict PKIX parsers used
// by both the persisted-key path and the JWK-header path.
// Centralised so a future "we now also accept raw 32-byte keys"
// migration can be applied in one location.

func parsePrivPEM(privPEM string) (ed25519.PrivateKey, error) {
	blk, _ := pem.Decode([]byte(privPEM))
	if blk == nil {
		return nil, errors.New("federation: priv: pem decode failed")
	}
	any, err := x509.ParsePKCS8PrivateKey(blk.Bytes)
	if err != nil {
		return nil, fmt.Errorf("federation: priv: parse pkcs8: %w", err)
	}
	priv, ok := any.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("federation: priv: not ed25519")
	}
	return priv, nil
}

func parsePubPEM(pubPEM string) (ed25519.PublicKey, error) {
	blk, _ := pem.Decode([]byte(pubPEM))
	if blk == nil {
		return nil, errors.New("federation: pub: pem decode failed")
	}
	any, err := x509.ParsePKIXPublicKey(blk.Bytes)
	if err != nil {
		return nil, fmt.Errorf("federation: pub: parse pkix: %w", err)
	}
	pub, ok := any.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("federation: pub: not ed25519")
	}
	return pub, nil
}
