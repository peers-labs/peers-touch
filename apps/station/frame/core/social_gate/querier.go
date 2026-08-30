package social_gate

import "context"

// RelationshipQuerier abstracts queries against the social graph.
// Implementations typically back onto the relationship subserver or a
// local cache of follow/block state.
type RelationshipQuerier interface {
	// AreMutualFollowers returns true if actorAPTID and actorBPTID follow each other.
	AreMutualFollowers(ctx context.Context, actorAPTID, actorBPTID string) (bool, error)

	// IsBlocked returns true if blocker has blocked blocked.
	IsBlocked(ctx context.Context, blockerPTID, blockedPTID string) (bool, error)

	// HaveSharedConversation returns true if actorAPTID and actorBPTID are both
	// members of at least one common conversation.
	HaveSharedConversation(ctx context.Context, actorAPTID, actorBPTID string) (bool, error)
}

// GroupRoleQuerier abstracts queries against conversation membership state.
type GroupRoleQuerier interface {
	// GetMemberStatus returns the role, status, and mute state for a member
	// within a conversation. role and status use the proto enum values from
	// the conversation domain model.
	GetMemberStatus(ctx context.Context, conversationID, actorPTID string) (role int32, status int32, muted bool, err error)
}

// FederationTrustQuerier abstracts the station-level trust registry.
// It determines whether a remote peer station is considered trustworthy
// for federated operations.
type FederationTrustQuerier interface {
	// IsTrustedStation returns true if the station identified by its peer ID
	// is currently in the trusted set.
	IsTrustedStation(stationPeerID string) bool
}
