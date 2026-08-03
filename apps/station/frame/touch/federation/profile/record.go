// record.go — canonical encoding, signing, and verification of
// pb.ActorProfileEnvelope values. Mirror of the locator package's
// record.go; the same federation Ed25519 key signs both, but the
// envelope carries a TTL window so a stolen-then-replayed copy cannot
// pretend to be live indefinitely.

package profile

import (
	"crypto/ed25519"
	"errors"
	"fmt"
	"strings"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	modelpb "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

// DefaultTTL is the wall-clock window an envelope is considered fresh.
// Receivers reject envelopes whose `expires_at_unix_ms` is in the past,
// so publishers MUST issue a new envelope at least once per TTL while
// they remain authoritative for the handle. Five minutes balances "low
// replay value if intercepted" against "low chatter on the resolver
// path"; the resolver layer caches successfully verified envelopes for
// the rest of their TTL window.
const DefaultTTL = 5 * time.Minute

// MaxTTL caps how far into the future a publisher may push expires_at.
// Without this bound a buggy publisher could mint an effectively-
// immortal envelope. One hour matches the relay-client token lifetime
// so envelope expiry stays comparable to other federation credentials.
const MaxTTL = time.Hour

// Errors callers can match on. Mirror locator's surface so the resolver
// can choose a single error-handling path for "verification failed".
var (
	ErrEmptyEnvelope    = errors.New("profile: empty envelope")
	ErrSignatureMissing = errors.New("profile: signature missing")
	ErrSignatureInvalid = errors.New("profile: signature invalid")
	ErrKeyKidMismatch   = errors.New("profile: signing_key_kid does not match signing_key_pem")
	ErrHandleMismatch   = errors.New("profile: federated_handle does not match expected")
	ErrEnvelopeExpired  = errors.New("profile: envelope expired")
	ErrInvalidPubKey    = errors.New("profile: signing_key_pem invalid")
	ErrLocalKeyMissing  = errors.New("profile: local key not loaded")
)

// SignInput is everything Sign needs to mint a fresh envelope. Inputs
// are validated; the resulting envelope carries a verifiable signature.
type SignInput struct {
	// Handle is the federated handle this envelope describes. Canonicalised
	// via locator.CanonicalHandle so receivers and senders agree on
	// byte-stable casing.
	Handle string

	// HomeStationPeerID is the libp2p PeerID of the authoritative station.
	// MUST equal the local station's PeerID — the builder enforces this.
	HomeStationPeerID string

	// HomeStationDomain is the DNS-style HTTP origin (no scheme).
	HomeStationDomain string

	// Profile is the public projection the publisher wants to attach.
	// Sensitive fields MUST already be cleared by the caller.
	Profile *modelpb.ActorProfile

	// DeviceSigningKeys are authenticated local actor-device public keys.
	DeviceSigningKeys []*modelpb.VerifiedActorDeviceSigningKey

	// Now is wall-clock at sign time. Tests inject deterministic clocks;
	// production passes time.Now().
	Now time.Time

	// TTL controls how long the envelope remains valid. Zero means
	// DefaultTTL; values larger than MaxTTL are clamped.
	TTL time.Duration

	// LocalKey is the station's federation Ed25519 keypair.
	LocalKey *authfed.LocalKey
}

// Sign produces a fully populated, signed ActorProfileEnvelope ready
// for transport. Stateless — callers cache the resulting bytes if they
// want to avoid re-signing.
func Sign(in SignInput) (*pb.ActorProfileEnvelope, []byte, error) {
	canonHandle, err := locator.CanonicalHandle(in.Handle)
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(in.HomeStationPeerID) == "" {
		return nil, nil, errors.New("profile: home_station_peer_id required")
	}
	if strings.TrimSpace(in.HomeStationDomain) == "" {
		return nil, nil, errors.New("profile: home_station_domain required")
	}
	if in.Profile == nil {
		return nil, nil, errors.New("profile: profile body required")
	}
	if in.LocalKey == nil || in.LocalKey.IsZero() || len(in.LocalKey.Priv) == 0 {
		return nil, nil, ErrLocalKeyMissing
	}

	ttl := in.TTL
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	if ttl > MaxTTL {
		ttl = MaxTTL
	}

	now := in.Now
	if now.IsZero() {
		now = time.Now()
	}

	env := &pb.ActorProfileEnvelope{
		FederatedHandle:   canonHandle,
		HomeStationPeerId: in.HomeStationPeerID,
		HomeStationDomain: in.HomeStationDomain,
		Profile:           in.Profile,
		DeviceSigningKeys: in.DeviceSigningKeys,
		IssuedAtUnixMs:    now.UnixMilli(),
		ExpiresAtUnixMs:   now.Add(ttl).UnixMilli(),
		SigningKeyPem:     in.LocalKey.PubPEM,
		SigningKeyKid:     in.LocalKey.Kid,
	}

	digest, err := canonicalDigest(env)
	if err != nil {
		return nil, nil, fmt.Errorf("profile: digest: %w", err)
	}
	env.Signature = ed25519.Sign(in.LocalKey.Priv, digest)

	bytes, err := proto.Marshal(env)
	if err != nil {
		return nil, nil, fmt.Errorf("profile: marshal: %w", err)
	}
	return env, bytes, nil
}

// VerifyOptions tunes Verify's strictness. The zero value is safe:
// expected handle required, expiry enforced.
type VerifyOptions struct {
	// ExpectedHandle, when non-empty, MUST equal the envelope's
	// federated_handle (canonicalised). Resolvers always pass this.
	ExpectedHandle string

	// ExpectedSigningKeyPEM, when non-empty, MUST equal the envelope's
	// signing_key_pem byte-for-byte. The resolver uses this to enforce
	// TOFU: the envelope MUST be signed by the same key the locator
	// record pinned. A mismatch is an attacker substituting a
	// look-alike envelope; the resolver returns an error rather than
	// falling back to a less strict check.
	ExpectedSigningKeyPEM string

	// Now is wall-clock for expiry comparison. Tests inject
	// deterministic clocks; production callers pass time.Now().
	Now time.Time

	// SkipExpiry, when true, disables the expires_at check. Diagnostic
	// callers may set this to inspect a freshly-stale envelope; the
	// resolver MUST leave it false.
	SkipExpiry bool
}

// Verify checks signature, key fingerprint, handle agreement, pinned
// key (when supplied), and expiry. Returns nil iff the envelope is
// acceptable.
func Verify(env *pb.ActorProfileEnvelope, opt VerifyOptions) error {
	if env == nil {
		return ErrEmptyEnvelope
	}
	if len(env.GetSignature()) == 0 {
		return ErrSignatureMissing
	}
	if env.GetSigningKeyPem() == "" {
		return ErrInvalidPubKey
	}

	pub, kid, err := parsePubPEMWithKid(env.GetSigningKeyPem())
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidPubKey, err)
	}
	if env.GetSigningKeyKid() != "" && env.GetSigningKeyKid() != kid {
		return ErrKeyKidMismatch
	}

	if opt.ExpectedSigningKeyPEM != "" &&
		strings.TrimSpace(env.GetSigningKeyPem()) != strings.TrimSpace(opt.ExpectedSigningKeyPEM) {
		return ErrKeyKidMismatch
	}

	if opt.ExpectedHandle != "" {
		canon, err := locator.CanonicalHandle(opt.ExpectedHandle)
		if err != nil {
			return fmt.Errorf("profile: bad expected handle: %w", err)
		}
		if env.GetFederatedHandle() != canon {
			return ErrHandleMismatch
		}
	}

	digest, err := canonicalDigest(env)
	if err != nil {
		return fmt.Errorf("profile: digest: %w", err)
	}
	if !ed25519.Verify(pub, digest, env.GetSignature()) {
		return ErrSignatureInvalid
	}

	if !opt.SkipExpiry && opt.Now.UnixMilli() > 0 {
		if env.GetExpiresAtUnixMs() > 0 && opt.Now.UnixMilli() > env.GetExpiresAtUnixMs() {
			return ErrEnvelopeExpired
		}
	}

	return nil
}

// canonicalDigest serialises an envelope EXCLUDING its Signature field
// with proto.MarshalOptions{Deterministic: true} so signers and
// verifiers agree on bytes regardless of field reordering.
func canonicalDigest(env *pb.ActorProfileEnvelope) ([]byte, error) {
	clone := proto.Clone(env).(*pb.ActorProfileEnvelope)
	clone.Signature = nil
	return proto.MarshalOptions{Deterministic: true}.Marshal(clone)
}

// parsePubPEMWithKid is local to this package so we don't pull the
// auth package's full surface into receivers. Returns the parsed key
// plus the canonical KID derived from its DER fingerprint.
func parsePubPEMWithKid(pemStr string) (ed25519.PublicKey, string, error) {
	pub, kid, err := authfed.ParsePeerJWKPEM(pemStr)
	if err != nil {
		return nil, "", err
	}
	if pub == nil {
		return nil, "", errors.New("profile: parsed nil pub key")
	}
	return pub, kid, nil
}
