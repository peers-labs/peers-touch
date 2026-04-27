package model

import "time"

// PeerKey is the cached public key of a remote peer station. It is
// the trust root the receiving OSS subserver consults when
// validating a federation JWT (typ=peer+jwt) on a cross-station
// GET /sub-oss/file request.
//
// The verifier policy is "trust on first use" (TOFU): the first
// well-formed token from a previously-unknown peer stamps a row
// here with the embedded JWK. Every subsequent token from that peer
// MUST present the same key — a kid mismatch is a hard 401, on the
// theory that an honest peer would have rotated its keys via an
// out-of-band re-pair flow and rotation is intentionally not in v1.
//
// The `Pinned` column is the upgrade path to operator-managed
// trust: a future dashboard endpoint will let the household admin
// promote a TOFU row to `Pinned=true`, after which key rotation
// requires re-pairing rather than silent acceptance.
type PeerKey struct {
	// PeerStationID is the value of the JWT `iss` claim. Today this
	// is the peer station's node ID (the same string that appears
	// in peer_addresses.peer_id). Treated as opaque by OSS.
	PeerStationID string `json:"peer_station_id" gorm:"primaryKey;type:varchar(255)"`

	// KID is the SHA-256 fingerprint of PublicKeyPEM, base32-nopad.
	// It must match the JWT `kid` header on every accepted token —
	// the JWK in the header (when present) is hashed and compared.
	KID string `json:"kid" gorm:"type:varchar(64);not null;index"`

	// PublicKeyPEM is the Ed25519 public key in PKIX/PEM form. We
	// store the PEM rather than the raw 32 bytes so an operator
	// reviewing the row in psql can read it without decoding tools.
	PublicKeyPEM string `json:"public_key_pem" gorm:"type:text;not null"`

	// FirstSeenAt is set once at TOFU time; it is the audit
	// breadcrumb that says "this peer first appeared on this
	// station at T". Operators reviewing audit rows correlate
	// against it when a key mismatch fires.
	FirstSeenAt time.Time `json:"first_seen_at" gorm:"not null"`

	// LastSeenAt is updated on every successful verification. The
	// dashboard surfaces stale rows so operators can prune peers
	// that have not federated in N days.
	LastSeenAt time.Time `json:"last_seen_at" gorm:"not null;index"`

	// Pinned, when true, freezes this row: a kid mismatch will be
	// rejected even if the new JWK is well-formed. Default false
	// keeps v1 TOFU semantics; operators upgrade via dashboard.
	Pinned bool `json:"pinned" gorm:"not null;default:false"`
}

// TableName binds PeerKey to its `oss_peer_keys` table.
func (PeerKey) TableName() string { return "oss_peer_keys" }

// Federation-specific oss_meta row keys. Kept here next to PeerKey
// because they belong to the same trust subsystem; the values live
// in the small Meta KV table to avoid a third one-row table.
const (
	// MetaKeyFederationPrivKey stores the PEM-encoded Ed25519
	// private key of THIS station, used to sign outbound peer
	// tokens. Generated lazily on first mint.
	MetaKeyFederationPrivKey = "federation_priv_pem"

	// MetaKeyFederationPubKey stores the matching public key. We
	// keep the public copy alongside the private so a future
	// dashboard /federation/publickey endpoint does not have to
	// re-derive it on every request.
	MetaKeyFederationPubKey = "federation_pub_pem"

	// MetaKeyFederationKID is the canonical KID our station
	// publishes in `kid` headers and JWK fingerprints. Persisting
	// it (rather than re-deriving it) means operators can grep
	// `oss_meta` for the kid this station claims without booting
	// the binary.
	MetaKeyFederationKID = "federation_kid"
)
