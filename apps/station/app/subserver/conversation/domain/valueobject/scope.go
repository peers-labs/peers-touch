package valueobject

import (
	"encoding/json"
	"strings"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
)

// ScopeKind discriminates the two authorization scopes a conversation can
// live under.
type ScopeKind string

const (
	// ScopeKindLocal is derived from Actor home-station ownership. It needs no
	// Federation, no ledger, and performs no network authorization.
	ScopeKindLocal ScopeKind = "local"
	// ScopeKindFederation references a real Federation and is authorized by
	// its active station/actor membership.
	ScopeKindFederation ScopeKind = "federation"
)

// Scope is the discriminated authorization scope of a conversation. It is a
// value, not an entity: Local scope is never created, stored as a Federation,
// or given a governance lifecycle. The zero value is invalid; build one with
// LocalScope or FederationScope.
type Scope struct {
	kind         ScopeKind
	stationID    StationID
	federationID FederationID
}

// LocalScope builds the same-station scope bound to an authority Station.
func LocalScope(station StationID) (Scope, error) {
	if strings.TrimSpace(string(station)) == "" {
		return Scope{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.scope",
			"station_id",
			"is required for a local scope",
		)
	}
	return Scope{kind: ScopeKindLocal, stationID: station}, nil
}

// FederationScope builds a cross-station scope referencing a Federation.
func FederationScope(federationID FederationID) (Scope, error) {
	if federationID == "" {
		return Scope{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.scope",
			"federation_id",
			"is required for a federation scope",
		)
	}
	return Scope{kind: ScopeKindFederation, federationID: federationID}, nil
}

// MustFederationScope builds a Federation scope from an already validated id.
// It panics on an empty id and is intended for rehydration paths.
func MustFederationScope(federationID FederationID) Scope {
	scope, err := FederationScope(federationID)
	if err != nil {
		panic(err)
	}
	return scope
}

// IsZero reports whether the scope is the invalid zero value.
func (s Scope) IsZero() bool { return s.kind == "" }

// Kind returns the discriminator.
func (s Scope) Kind() ScopeKind { return s.kind }

// IsLocal reports whether this is a same-station scope.
func (s Scope) IsLocal() bool { return s.kind == ScopeKindLocal }

// IsFederation reports whether this is a Federation scope.
func (s Scope) IsFederation() bool { return s.kind == ScopeKindFederation }

// LocalStation returns the bound Station for a local scope.
func (s Scope) LocalStation() StationID { return s.stationID }

// FederationID returns the referenced Federation id and whether the scope is
// a federation scope. Local scopes return ("", false).
func (s Scope) FederationID() (FederationID, bool) {
	if s.kind != ScopeKindFederation {
		return "", false
	}
	return s.federationID, true
}

// FederationIDOrEmpty returns the federation id or "" for a local scope. This
// exists only at persistence/wire boundaries; domain decisions must use
// IsLocal/IsFederation rather than comparing this string.
func (s Scope) FederationIDOrEmpty() FederationID {
	if s.kind != ScopeKindFederation {
		return ""
	}
	return s.federationID
}

// Equal compares scopes by kind and their bound identity.
func (s Scope) Equal(other Scope) bool {
	if s.kind != other.kind {
		return false
	}
	switch s.kind {
	case ScopeKindLocal:
		return s.stationID == other.stationID
	case ScopeKindFederation:
		return s.federationID == other.federationID
	default:
		return false
	}
}

// Canonical returns the deterministic encoding used by the event hash chain
// and optimistic-concurrency tokens. It never changes within a kind/value and
// never collides across kinds.
func (s Scope) Canonical() string {
	switch s.kind {
	case ScopeKindLocal:
		return string(ScopeKindLocal) + "\x00" + string(s.stationID)
	case ScopeKindFederation:
		return string(ScopeKindFederation) + "\x00" + string(s.federationID)
	default:
		return ""
	}
}

// ScopeFromPersistence rebuilds a scope from the stored kind and nullable
// federation id. kind=local ignores the federation id; kind=federation
// requires a non-empty id.
func ScopeFromPersistence(kind ScopeKind, federationID FederationID, localStation StationID) (Scope, error) {
	switch kind {
	case ScopeKindLocal:
		return LocalScope(localStation)
	case ScopeKindFederation:
		return FederationScope(federationID)
	default:
		return Scope{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"valueobject.scope",
			"scope_kind",
			"must be local or federation",
		)
	}
}

// scopeWire is the JSON shape of Scope. Its discriminator plus the single
// bound identity keeps persisted snapshots canonical across the private-field
// value object.
type scopeWire struct {
	Kind         ScopeKind    `json:"kind"`
	StationID    StationID    `json:"station_id,omitempty"`
	FederationID FederationID `json:"federation_id,omitempty"`
}

// MarshalJSON encodes the discriminator and the bound identity.
func (s Scope) MarshalJSON() ([]byte, error) {
	if s.IsZero() {
		return []byte("null"), nil
	}
	wire := scopeWire{Kind: s.kind}
	switch s.kind {
	case ScopeKindLocal:
		wire.StationID = s.stationID
	case ScopeKindFederation:
		wire.FederationID = s.federationID
	}
	return json.Marshal(wire)
}

// UnmarshalJSON rebuilds a validated scope from its wire shape.
func (s *Scope) UnmarshalJSON(bytes []byte) error {
	if string(bytes) == "null" {
		*s = Scope{}
		return nil
	}
	var wire scopeWire
	if err := json.Unmarshal(bytes, &wire); err != nil {
		return err
	}
	rebuilt, err := ScopeFromPersistence(wire.Kind, wire.FederationID, wire.StationID)
	if err != nil {
		return err
	}
	*s = rebuilt
	return nil
}
