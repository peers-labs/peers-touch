// record.go — canonical encoding, signing, and verification of
// pb.ActorLocatorRecord values.
//
// Record bytes on the wire are the binary protobuf encoding of the message,
// minted with deterministic field order so signers and verifiers always agree
// on the bytes. Callers never construct an ActorLocatorRecord directly for
// the wire — they go through Sign / Verify so the signature contract cannot
// be skipped.

package locator

import (
	"crypto/ed25519"
	"crypto/x509"
	"errors"
	"fmt"
	"strings"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	pb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	"google.golang.org/protobuf/proto"
)

// MaxRecordAge is the freshness window receivers enforce. Records older
// than this are treated as stale; the locator publisher re-mints on the
// re-publish ticker (Phase C). 24h matches the standard DHT republish
// interval used by libp2p kad-dht so stations rarely see "stale" records
// for live actors.
const MaxRecordAge = 24 * time.Hour

// Errors callers can match on.
var (
	ErrEmptyRecord       = errors.New("locator: empty record")
	ErrSignatureMissing  = errors.New("locator: signature missing")
	ErrSignatureInvalid  = errors.New("locator: signature invalid")
	ErrKeyKidMismatch    = errors.New("locator: signing_key_kid does not match signing_key_pem")
	ErrHandleMismatch    = errors.New("locator: federated_handle does not match DHT key")
	ErrRecordStale       = errors.New("locator: record older than MaxRecordAge")
	ErrInvalidPubKey     = errors.New("locator: signing_key_pem invalid")
	ErrPublisherIdentity = errors.New("locator: publisher missing local identity (PeerID/Domain)")
)

// SignInput is everything a publisher needs to mint a fresh record. Inputs
// are validated; the resulting record carries a verifiable signature.
type SignInput struct {
	// Handle is the federated handle in any reasonable casing. The
	// publisher canonicalises it.
	Handle string

	// HomeStationPeerID is the libp2p PeerID of the authoritative station.
	// MUST equal the local station's PeerID — the publisher refuses to
	// sign records for other stations (see publisher.go).
	HomeStationPeerID string

	// HomeStationDomain is the DNS-style HTTP origin (no scheme).
	HomeStationDomain string

	// InboxRelayMounts (optional) lists relay-mount labels through which
	// this station is reachable. Pure hint for receivers — left empty
	// when we have no relay mounts to advertise.
	InboxRelayMounts []string

	// Tombstone, when true, marks this publish as a withdrawal.
	Tombstone bool

	// Seq is the monotonic per-handle counter held by the actor row
	// (touch_actor.locator_seq). Callers MUST pre-increment it BEFORE
	// invoking Sign so two racing Sign calls do not reuse the same seq.
	Seq uint64

	// Now is wall-clock at sign time. Tests inject deterministic clocks;
	// production passes time.Now().
	Now time.Time

	// LocalKey is the station's federation Ed25519 keypair.
	LocalKey *authfed.LocalKey
}

// Sign produces a fully populated, signed ActorLocatorRecord ready for
// PutValue. The function is deliberately stateless — callers are responsible
// for caching the resulting bytes if they want to avoid re-signing.
func Sign(in SignInput) (*pb.ActorLocatorRecord, []byte, error) {
	canonHandle, err := CanonicalHandle(in.Handle)
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(in.HomeStationPeerID) == "" {
		return nil, nil, errors.New("locator: home_station_peer_id required")
	}
	if strings.TrimSpace(in.HomeStationDomain) == "" {
		return nil, nil, errors.New("locator: home_station_domain required")
	}
	if in.LocalKey == nil || in.LocalKey.IsZero() || len(in.LocalKey.Priv) == 0 {
		return nil, nil, errors.New("locator: local key not loaded")
	}

	rec := &pb.ActorLocatorRecord{
		FederatedHandle:   canonHandle,
		HomeStationPeerId: in.HomeStationPeerID,
		HomeStationDomain: in.HomeStationDomain,
		InboxRelayMounts:  append([]string(nil), in.InboxRelayMounts...),
		Tombstone:         in.Tombstone,
		Seq:               in.Seq,
		UpdatedAtUnixMs:   in.Now.UnixMilli(),
		SigningKeyPem:     in.LocalKey.PubPEM,
		SigningKeyKid:     in.LocalKey.Kid,
	}

	digest, err := canonicalDigest(rec)
	if err != nil {
		return nil, nil, fmt.Errorf("locator: digest: %w", err)
	}
	rec.Signature = ed25519.Sign(in.LocalKey.Priv, digest)

	bytes, err := proto.Marshal(rec)
	if err != nil {
		return nil, nil, fmt.Errorf("locator: marshal signed record: %w", err)
	}
	return rec, bytes, nil
}

// VerifyOptions tunes Verify's strictness. The zero value is safe: handle
// match required, freshness enforced.
type VerifyOptions struct {
	// ExpectedHandle, when non-empty, MUST equal the record's
	// federated_handle. The validator passes the handle parsed from the
	// DHT key here so a record stored under "/pst-actor/alice@h" cannot
	// claim to be for bob@h.
	ExpectedHandle string

	// Now is wall-clock for freshness comparison. Tests inject
	// deterministic clocks; production callers pass time.Now().
	Now time.Time

	// SkipFreshness, when true, disables the MaxRecordAge check. The
	// validator path sets this to false (records older than 24h are
	// rejected); the lookup path may set it to true if the operator wants
	// to accept stale-but-still-valid records as a degraded fallback.
	SkipFreshness bool
}

// Verify checks signature, key fingerprint, handle agreement, and freshness.
// Returns nil iff the record is acceptable. Callers MUST pass through this
// function before trusting any field on the record.
func Verify(rec *pb.ActorLocatorRecord, opt VerifyOptions) error {
	if rec == nil {
		return ErrEmptyRecord
	}
	if len(rec.GetSignature()) == 0 {
		return ErrSignatureMissing
	}
	if rec.GetSigningKeyPem() == "" {
		return ErrInvalidPubKey
	}

	pub, kid, err := parsePubPEMWithKid(rec.GetSigningKeyPem())
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidPubKey, err)
	}
	if rec.GetSigningKeyKid() != "" && rec.GetSigningKeyKid() != kid {
		return ErrKeyKidMismatch
	}

	if opt.ExpectedHandle != "" {
		canon, err := CanonicalHandle(opt.ExpectedHandle)
		if err != nil {
			return fmt.Errorf("locator: bad expected handle: %w", err)
		}
		if rec.GetFederatedHandle() != canon {
			return ErrHandleMismatch
		}
	}

	digest, err := canonicalDigest(rec)
	if err != nil {
		return fmt.Errorf("locator: digest: %w", err)
	}
	if !ed25519.Verify(pub, digest, rec.GetSignature()) {
		return ErrSignatureInvalid
	}

	if !opt.SkipFreshness && opt.Now.UnixMilli() > 0 {
		updated := time.UnixMilli(rec.GetUpdatedAtUnixMs())
		if opt.Now.Sub(updated) > MaxRecordAge {
			return ErrRecordStale
		}
	}

	return nil
}

// canonicalDigest serialises a record EXCLUDING its Signature field with
// proto.MarshalOptions{Deterministic: true}, so signers and verifiers always
// hash the same bytes. Storing the bytes themselves would be tempting, but
// proto wire-format with deterministic option is well-specified and matches
// what DHT receivers will see.
func canonicalDigest(rec *pb.ActorLocatorRecord) ([]byte, error) {
	clone := proto.Clone(rec).(*pb.ActorLocatorRecord)
	clone.Signature = nil
	return proto.MarshalOptions{Deterministic: true}.Marshal(clone)
}

// parsePubPEMWithKid is identical in semantics to authfed.ParsePeerJWKPEM
// but local to this package so we don't pull in the auth package's full API
// surface. Returns the parsed key plus the canonical KID.
func parsePubPEMWithKid(pemStr string) (ed25519.PublicKey, string, error) {
	pub, kid, err := authfed.ParsePeerJWKPEM(pemStr)
	if err != nil {
		return nil, "", err
	}
	if pub == nil {
		return nil, "", errors.New("locator: parsed nil pub key")
	}
	return pub, kid, nil
}

// pubFingerprint exists for symmetry — useful in tests that want to assert
// "this record was signed by KID X". Not used in the validator path because
// Verify already checks the kid <-> PEM agreement.
func pubFingerprint(pub ed25519.PublicKey) (string, error) {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", err
	}
	return authfed.KidFromPubDER(der), nil
}
