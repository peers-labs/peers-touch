// Package identity is the single owner of Peers-Touch domain identifier
// generation and classification on the Station application side.
//
// # Identifier taxonomy
//
// Peers-Touch has two orthogonal identifier families. They must never be
// merged or coerced into one another.
//
//  1. Network identity (cryptographic, dialable).
//     Station root, physical Node, and Relay identities are libp2p PeerIDs
//     derived from ed25519 keys (e.g. "12D3KooW..."). They authenticate a
//     network endpoint and are owned by the frame peer/trust layer
//     (frame/touch/model/peer, frame/core/plugin/native). A virtual entity
//     with no key and no socket MUST NOT be given a PeerID.
//
//  2. Domain resource identity (generated, non-dialable).
//     Persistent application entities that are not network endpoints receive
//     a prefixed, lexicographically time-sortable ULID from this package:
//     a Federation is a permissioned virtual network/ledger (KindFederation),
//     a ledger event is a governance fact (KindLedgerEvent), and so on.
//     These ids never authenticate a transport and are not resolvable in the
//     DHT.
//
// Conversation authorization scopes are not ids minted here: they are a
// discriminated value owned by the conversation domain
// (valueobject.Scope: Local or Federation). Same-station conversations carry
// no Federation id at all.
package identity

import (
	"crypto/rand"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
)

// Kind is the canonical, closed set of domain resource id prefixes. Adding a
// prefix here is the only sanctioned way to introduce a new resource id form.
type Kind string

const (
	// KindFederation identifies a Federation virtual network/ledger.
	KindFederation Kind = "fed"
	// KindLedgerEvent identifies one append-only Federation ledger fact.
	KindLedgerEvent Kind = "evt"
)

const separator = "_"

var ulidEntropy = ulid.Monotonic(rand.Reader, 0)

// New returns a new prefixed resource id for the kind. A ULID is generated from
// the current wall clock with process-monotonic entropy; a timestamp/entropy
// failure falls back to the library constructor so callers never receive an
// empty id.
func New(kind Kind) string {
	value, err := ulid.New(ulid.Timestamp(time.Now()), ulidEntropy)
	if err != nil {
		value = ulid.Make()
	}
	return string(kind) + separator + value.String()
}

// NewFederationID returns a new Federation resource id.
func NewFederationID() string { return New(KindFederation) }

// NewLedgerEventID returns a new ledger event resource id.
func NewLedgerEventID() string { return New(KindLedgerEvent) }

// ulidLength is the canonical Crockford-base32 length produced by ulid.Make.
const ulidLength = 26

// KindOf reports the registered prefix kind encoded in id, or false when the
// id does not match the canonical "<prefix>_<26-char-ulid>" shape.
func KindOf(id string) (Kind, bool) {
	prefix, suffix, ok := strings.Cut(id, separator)
	if !ok || len(suffix) != ulidLength {
		return "", false
	}
	switch Kind(prefix) {
	case KindFederation, KindLedgerEvent:
		return Kind(prefix), true
	default:
		return "", false
	}
}
