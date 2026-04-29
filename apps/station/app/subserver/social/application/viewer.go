package application

import (
	"context"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
)

// buildViewer constructs a `domain.Viewer` for the supplied actor id by
// querying every relationship-graph repo the viewer touches:
//
//   - Following: who does this viewer follow → drives FOLLOWERS audience
//     visibility checks AND the HOME timeline merge of public-followed +
//     private-followed-followers.
//   - MemberOfCircles: which circles is this viewer a member of → drives
//     CIRCLE audience visibility AND the HOME timeline merge of circle
//     posts. Membership is keyed by DID; we resolve the viewer's DID
//     via ActorResolver. P1 uses a no-op resolver so this set is
//     effectively empty until P3 wires the real resolver.
//   - MemberOfGroups: which chat groups is this viewer a member of →
//     drives GROUP audience visibility AND the HOME timeline merge of
//     group posts. P1 uses a no-op GroupMembershipChecker so this set
//     is effectively empty until P3.
//
// Anonymous viewers (viewerID == 0) get a zero-valued Viewer; CanRead
// will treat them as eligible only for PUBLIC posts (legacy
// compatibility). The buildViewer helper is intentionally permissive
// in that case — it returns an empty Viewer rather than an error so
// public read paths remain anonymous-friendly.
//
// Errors from the underlying repos are returned to the caller; an
// incomplete Viewer would silently degrade to "zero-membership", which
// would then cause CanRead to deny posts the viewer should be allowed
// to see — a worse failure mode than a 5xx.
func buildViewer(
	ctx context.Context,
	viewerID uint64,
	repos *infrastructure.Repos,
	resolveDID func(context.Context, uint64) (string, error),
	groups domain.GroupMembershipChecker,
) (domain.Viewer, error) {
	if viewerID == 0 {
		return domain.Viewer{}, nil
	}

	var v domain.Viewer
	v.ActorID = viewerID

	if resolveDID != nil {
		did, err := resolveDID(ctx, viewerID)
		if err != nil {
			return domain.Viewer{}, err
		}
		v.ActorDID = did
	}

	followingIDs, err := repos.Follows.FollowingActorIDs(ctx, viewerID)
	if err != nil {
		return domain.Viewer{}, err
	}
	if len(followingIDs) > 0 {
		v.Following = make(map[uint64]struct{}, len(followingIDs))
		for _, id := range followingIDs {
			v.Following[id] = struct{}{}
		}
	}

	if v.ActorDID != "" {
		circleIDs, err := repos.Circles.MembershipsForViewer(ctx, v.ActorDID)
		if err != nil {
			return domain.Viewer{}, err
		}
		if len(circleIDs) > 0 {
			v.MemberOfCircles = make(map[uint64]struct{}, len(circleIDs))
			for _, id := range circleIDs {
				v.MemberOfCircles[id] = struct{}{}
			}
		}
	}

	if groups != nil {
		groupIDs, err := groups.MembershipsForViewer(ctx, viewerID)
		if err != nil {
			return domain.Viewer{}, err
		}
		if len(groupIDs) > 0 {
			v.MemberOfGroups = make(map[uint64]struct{}, len(groupIDs))
			for _, id := range groupIDs {
				v.MemberOfGroups[id] = struct{}{}
			}
		}
	}

	return v, nil
}
