// Package credential supplies opaque delegation secrets, independent of the
// product using them. Only a digest and non-reversible display hint persist.
package credential

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

func Generate() (string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", err
	}
	return "ptsec_" + hex.EncodeToString(secret), nil
}

func Hash(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

func Hint(plaintext string) string {
	if len(plaintext) <= 4 {
		return "••••"
	}
	return "•••• " + plaintext[len(plaintext)-4:]
}

func Verify(storedHash, presented string) bool {
	// Always compare fixed-size digests, including misses. The result also
	// requires a real stored credential and a nonempty presented secret.
	dummy := Hash("")
	if storedHash == "" {
		storedHash = dummy
	}
	want := Hash(strings.TrimSpace(presented))
	match := subtle.ConstantTimeCompare([]byte(want), []byte(storedHash)) == 1
	return match && storedHash != dummy && strings.TrimSpace(presented) != ""
}
