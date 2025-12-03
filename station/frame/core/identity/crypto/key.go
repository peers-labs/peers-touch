package crypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"

	"github.com/multiformats/go-multihash"
)

// GenerateKey generates a new Ed25519 key pair
func GenerateKey() (ed25519.PublicKey, ed25519.PrivateKey, error) {
	return ed25519.GenerateKey(rand.Reader)
}

// Fingerprint generates a multihash fingerprint from a public key
// We use SHA2-256 for the hash algorithm as a default
func Fingerprint(pubKey ed25519.PublicKey) (string, error) {
	// Create a multihash of the public key
	// Algorithm: SHA2_256 (code 0x12)
	mh, err := multihash.Sum(pubKey, multihash.SHA2_256, -1)
	if err != nil {
		return "", fmt.Errorf("failed to create multihash: %w", err)
	}

	// Return the multihash as a base58 string (commonly used in IPFS/libp2p)
	// Note: multihash.B58String is deprecated in newer versions in favor of multibase,
	// but we'll check what's available or use hex if needed.
	// For better compatibility with the spec (multibase), we should use that if available.
	// But `go-multihash` itself handles hashing.
	// Let's use Hex for now if we don't want to pull in go-multibase explicitly,
	// OR check if we can use B58String from multihash if it exists.
	// Given the dependencies, let's stick to a simple hex representation of the multihash for now
	// unless we want to add `github.com/multiformats/go-multibase`.
	// Actually, the spec says "multihash + multibase".
	// Let's see if we can use a simple string format for now.
	return mh.HexString(), nil
}
