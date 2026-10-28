// Package social_gate defines the social-layer access control interface.
// It gates operations (create conversation, send message, manage members, etc.)
// based on relationship state, group roles, and federation trust — without
// embedding policy evaluation logic itself.
package social_gate

import "context"

// SocialGate evaluates whether a given operation is permitted under the
// current social policy. Implementations may compose relationship checks,
// role checks, rate limits, and federation trust into a single verdict.
type SocialGate interface {
	Evaluate(ctx context.Context, op Operation) error
}

// Operation describes what the caller intends to do. The gate inspects these
// fields against policy rules to produce allow / deny / rate-limit verdicts.
type Operation struct {
	// Action identifies the semantic operation being attempted.
	// Known values: "create_direct", "send_message", "add_member",
	// "remove_member", "dissolve", "leave",
	// "dkx_send", "fetch_key_package".
	Action string

	// TargetPtid is the ptid of the target actor for bilateral operations.
	// Empty for self/list operations or operations that only reference a conversation.
	TargetPtid string

	// ConversationID identifies the target conversation.
	// Empty for creation operations that have not yet allocated an ID.
	ConversationID string

	// ScopeKind discriminates the conversation authorization scope. It is a
	// frame-owned simple contract because frame must not depend on the app's
	// conversation value object.
	ScopeKind ScopeKind

	// Scope is the Federation resource id for a federation-scoped operation.
	// It is empty for a local-scope or scope-free action.
	Scope string

	// SubjectStationPeerID is the Home Station of the authenticated actor.
	SubjectStationPeerID string

	// TargetStationPeerID is the Home Station of the target actor. The gate
	// classifies same-station vs cross-station from these fields; callers
	// resolve them through the actor home-station capability, never from URL.
	TargetStationPeerID string
}

// ScopeKind is the frame-owned discriminator for a conversation scope.
type ScopeKind string

const (
	// ScopeKindLocal is a same-station scope derived from Actor home-station
	// ownership. It references no Federation and never crosses stations.
	ScopeKindLocal ScopeKind = "local"
	// ScopeKindFederation references a real Federation and is authorized by
	// its active station/actor membership.
	ScopeKindFederation ScopeKind = "federation"
)

// SameStation reports whether the operation is provably local: both actors'
// Home Stations are known and identical. Empty station fields are not local.
func (o Operation) SameStation() bool {
	return o.SubjectStationPeerID != "" &&
		o.SubjectStationPeerID == o.TargetStationPeerID
}

// LocalScope reports whether the operation is explicitly same-station scoped.
func (o Operation) LocalScope() bool { return o.ScopeKind == ScopeKindLocal }
