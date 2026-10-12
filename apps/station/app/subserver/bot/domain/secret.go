package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

const secretPrefix = "ptsec_"

// GenerateSecret returns a new opaque webhook secret: "ptsec_" + 32 hex chars.
func GenerateSecret() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return secretPrefix + hex.EncodeToString(b), nil
}

// GenerateWebhookID returns the public, non-secret webhook path identifier:
// "wh_" + 12 hex chars.
func GenerateWebhookID() (string, error) {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "wh_" + hex.EncodeToString(b), nil
}

// HashSecret stores only a SHA-256 hex digest; plaintext is never persisted.
func HashSecret(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// SecretHint returns a non-reversible display fragment (last 4 chars) shown
// in the management UI, mirroring the prototype "•••• a71c".
func SecretHint(plaintext string) string {
	if len(plaintext) <= 4 {
		return "••••"
	}
	return "•••• " + plaintext[len(plaintext)-4:]
}

// VerifySecret does a constant-time comparison of a presented secret against
// the stored hash.
func VerifySecret(storedHash, presented string) bool {
	if storedHash == "" || presented == "" {
		return false
	}
	want := HashSecret(strings.TrimSpace(presented))
	return subtle.ConstantTimeCompare([]byte(want), []byte(storedHash)) == 1
}
