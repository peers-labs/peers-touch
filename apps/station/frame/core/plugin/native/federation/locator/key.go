// key.go — DHT key derivation and namespace constants for the locator.
//
// Receivers and senders MUST agree on every byte of the DHT key, so
// canonicalisation is centralised here and used by both the publisher and
// the validator. Variations are forbidden by design — even a trailing slash
// would split the namespace into two unreachable halves.

package locator

import (
	"errors"
	"strings"
)

// Namespace is the kad-DHT namespace registered for actor locator records.
// We deliberately use a separate namespace from the existing "pst" registry
// records so:
//   - the existing peer-record validator stays unchanged;
//   - operators can grep DHT key dumps for "/pst-actor/" and immediately
//     identify federation user pointers;
//   - a future schema change to actor records can ship a new namespace
//     ("pst-actor-v2") without breaking unrelated registry consumers.
const Namespace = "pst-actor"

// keyPrefix is the full key prefix every locator key carries. Always
// "/pst-actor/" — no trailing-slash variations allowed.
const keyPrefix = "/" + Namespace + "/"

// ErrInvalidKey is returned by ParseKey when the input does not parse as a
// canonical locator key.
var ErrInvalidKey = errors.New("locator: invalid DHT key")

// CanonicalHandle normalises a federated handle into the form the DHT key
// derivation expects. It:
//   - trims surrounding whitespace,
//   - removes a single leading '@' if present (so callers may pass either
//     "@alice@host" or "alice@host"),
//   - lower-cases the whole string,
//   - rejects empty / whitespace-only input.
//
// The function deliberately does NOT enforce DNS-shape on the host portion;
// that validation belongs in the actor write path so locator stays a pure
// transport layer.
func CanonicalHandle(handle string) (string, error) {
	h := strings.TrimSpace(handle)
	if h == "" {
		return "", errors.New("locator: empty handle")
	}
	h = strings.TrimPrefix(h, "@")
	h = strings.ToLower(h)
	if h == "" {
		return "", errors.New("locator: empty handle after canonicalisation")
	}
	if !strings.Contains(h, "@") {
		return "", errors.New("locator: handle must be of form user@host")
	}
	return h, nil
}

// DHTKey builds the canonical DHT key for a federated handle. The handle is
// passed through CanonicalHandle, so callers may use any reasonable casing
// or leading-'@' variant.
func DHTKey(handle string) (string, error) {
	h, err := CanonicalHandle(handle)
	if err != nil {
		return "", err
	}
	return keyPrefix + h, nil
}

// MustDHTKey is the panic-on-error convenience wrapper used by tests and
// startup wiring where the input is a constant. Production code MUST use
// DHTKey and check the error.
func MustDHTKey(handle string) string {
	k, err := DHTKey(handle)
	if err != nil {
		panic(err)
	}
	return k
}

// ParseKey is the inverse of DHTKey: given a "/pst-actor/<handle>" key it
// returns the canonical handle. Used by the validator to recover the handle
// before signature verification.
func ParseKey(key string) (string, error) {
	if !strings.HasPrefix(key, keyPrefix) {
		return "", ErrInvalidKey
	}
	handle := strings.TrimPrefix(key, keyPrefix)
	if handle == "" {
		return "", ErrInvalidKey
	}
	canon, err := CanonicalHandle(handle)
	if err != nil {
		return "", ErrInvalidKey
	}
	if canon != handle {
		// A non-canonical handle in the key means the publisher did not
		// pass the input through CanonicalHandle. We refuse to accept it
		// rather than silently coerce — otherwise two publishers writing
		// the same logical handle could end up at different keys.
		return "", ErrInvalidKey
	}
	return handle, nil
}
