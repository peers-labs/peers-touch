package domain

import "context"

// ActorResolver bridges the gap between the DID-based identity surface
// used in `Audience` (where actors are `string` DIDs to keep the proto
// federation-ready) and the internal numeric `actor_id` used by all
// repositories.
//
// A typical resolution call looks up `[]actor_did → []actor_id` so the
// server can persist CUSTOM_* allow/deny lists efficiently keyed by
// `actor_did` (the same DID can survive an actor's local numeric id
// rotation, and may originate from a future federated peer). DIDs that
// don't resolve to a known local actor are returned as a zero ID — the
// application layer decides whether that's a soft warning ("invitee not
// yet on this Station, will become visible when they join") or a hard
// 400 ("typo in the DID list").
//
// This is a CONTRACT interface — implementations live elsewhere
// (typically `frame/touch/actor`); the social subserver wires a default
// no-op implementation in P1 and swaps in a real one in P3 when the
// chat / actor subservers ratify their lookup APIs. See the P3 entry in
// `.dev-workflow/20260427-193038/plan.md §6`.
type ActorResolver interface {
	// ResolveDIDs maps each input DID to the corresponding local actor
	// id. The output slice has the same length and order as the input;
	// unknown DIDs map to 0. Implementations MUST NOT return an error
	// for "unknown DID" — they only return errors for transport / DB
	// failures.
	ResolveDIDs(ctx context.Context, actorDIDs []string) ([]uint64, error)

	// ResolveID is the inverse of `ResolveDIDs` for a single id. Used
	// when constructing a `Viewer` from the JWT subject (which carries
	// the local numeric id but not the DID).
	ResolveID(ctx context.Context, actorID uint64) (string, error)
}

// GroupMembershipChecker bridges to the chat subserver's `Group` domain.
// `Audience.kind == GROUP` posts target a `chat.Group` by id; the social
// subserver asks this contract two questions during write / read paths:
//
//  1. "Is this author a member of the target group?" — write-time
//     validation in `MomentService.Create` (so a bad client can't post
//     into groups they don't belong to).
//
//  2. "Which groups is this viewer a member of?" — read-time when
//     constructing a `Viewer` for `CanRead` and when feeding the
//     multi-source HOME merge.
//
// Like `ActorResolver`, P1 ships with a no-op default implementation
// (always-allow on IsMember, empty list on MembershipsForViewer) so the
// build is wired end-to-end. The chat subserver is expected to register
// a real implementation in P3; until then GROUP-audience posts will
// effectively bypass membership checks (logged as a WARN at startup).
type GroupMembershipChecker interface {
	IsMember(ctx context.Context, groupID, actorID uint64) (bool, error)
	MembershipsForViewer(ctx context.Context, viewerID uint64) ([]uint64, error)
}
