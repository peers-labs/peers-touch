package identity

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
func Fingerprint(pubKey ed25519.PublicKey) (string, error) {
	mh, err := multihash.Sum(pubKey, multihash.SHA2_256, -1)
	if err != nil {
		return "", fmt.Errorf("failed to create multihash: %w", err)
	}
	return mh.HexString(), nil
}
