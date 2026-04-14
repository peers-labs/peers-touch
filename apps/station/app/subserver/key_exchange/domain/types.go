package domain

import "time"

type KeyBundle struct {
	ActorDID       string
	IdentityKeyPub []byte // Ed25519 public key (32 bytes)
	KeyFingerprint string // hex-encoded fingerprint
	SignedPreKey   SignedPreKey
	OneTimePreKeys []OneTimePreKey
	CreatedAt      time.Time
	UpdatedAt      time.Time
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
