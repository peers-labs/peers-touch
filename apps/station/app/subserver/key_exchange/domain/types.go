package domain

import "time"

// KeyBundle is one device-scoped publish for a DID.
type KeyBundle struct {
	ActorDID          string
	DeviceID          string // authenticated, non-empty device address
	IdentityKeyPub    []byte // Ed25519 public key (32 bytes)
	KeyFingerprint    string // hex-encoded fingerprint
	SignedPreKey      SignedPreKey
	OneTimePreKeys    []OneTimePreKey
	PublishedAtUnixMs int64
	SupportedVersions []uint32
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type SignedPreKey struct {
	ID        int32
	PublicKey []byte // X25519 public key (32 bytes)
	Signature []byte // Ed25519 signature of PublicKey
	CreatedAt time.Time
}

type OneTimePreKey struct {
	ID        int32
	PublicKey []byte // X25519 public key (32 bytes)
	Consumed  bool
}
