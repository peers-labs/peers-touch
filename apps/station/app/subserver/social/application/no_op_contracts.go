package application

import (
	"context"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
)

// noopActorResolver is the default `domain.ActorResolver` implementation
// for P1. It returns empty DIDs and zero IDs — sufficient to keep the
// build wired end-to-end and the application services running, but
// effectively disables every CUSTOM_* / CIRCLE check that needs a DID
// to enforce.
//
// P3 will swap in a real resolver backed by `frame/touch/actor` once
// that surface ratifies a stable lookup API. Until then, posts using
// CUSTOM_ALLOW / CUSTOM_DENY / CIRCLE audiences are visible only to
// the author themselves (the author-shortcut in `CanRead` still works
// because it doesn't need DID resolution). This degradation is logged
// at WARN at startup so operators understand the limitation.
type noopActorResolver struct{}

func NewNoopActorResolver() domain.ActorResolver { return noopActorResolver{} }

func (noopActorResolver) ResolveDIDs(_ context.Context, dids []string) ([]uint64, error) {
	return make([]uint64, len(dids)), nil
}

func (noopActorResolver) ResolveID(_ context.Context, _ uint64) (string, error) {
	return "", nil
}

// noopGroupChecker is the default `domain.GroupMembershipChecker`
// implementation for P1 — see noopActorResolver for the same caveat.
// `IsMember` returns FALSE so GROUP-audience posts are write-rejected
// (no one is a member, including the author); `MembershipsForViewer`
// returns an empty list so GROUP posts don't appear in any HOME merge.
//
// In production this means GROUP-audience moments cannot be created in
// P1 — clients should instead use FOLLOWERS or CIRCLE. The handler
// surfaces a clear 400 error: "GROUP audience requires the chat
// subserver, not yet wired (P3)".
type noopGroupChecker struct{}

func NewNoopGroupMembershipChecker() domain.GroupMembershipChecker { return noopGroupChecker{} }

func (noopGroupChecker) IsMember(_ context.Context, _ uint64, _ uint64) (bool, error) {
	return false, nil
}

func (noopGroupChecker) MembershipsForViewer(_ context.Context, _ uint64) ([]uint64, error) {
	return nil, nil
}
