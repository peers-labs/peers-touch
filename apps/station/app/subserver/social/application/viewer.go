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
	blockedFollowing, err := blockedActorIDs(ctx, repos, viewerID, followingIDs)
	if err != nil {
		return domain.Viewer{}, err
	}
	if len(followingIDs) > 0 {
		v.Following = make(map[uint64]struct{}, len(followingIDs))
		for _, id := range followingIDs {
			if blockedFollowing[id] {
				continue
			}
			v.Following[id] = struct{}{}
		}
	}
	if len(blockedFollowing) > 0 {
		v.BlockedActors = make(map[uint64]struct{}, len(blockedFollowing))
		for id, blocked := range blockedFollowing {
			if blocked {
				v.BlockedActors[id] = struct{}{}
			}
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

func buildViewerForAuthors(
	ctx context.Context,
	viewerID uint64,
	repos *infrastructure.Repos,
	resolveDID func(context.Context, uint64) (string, error),
	groups domain.GroupMembershipChecker,
	authorIDs []uint64,
) (domain.Viewer, error) {
	viewer, err := buildViewer(ctx, viewerID, repos, resolveDID, groups)
	if err != nil {
		return domain.Viewer{}, err
	}
	if err := markBlockedAuthors(ctx, &viewer, repos, authorIDs); err != nil {
		return domain.Viewer{}, err
	}
	return viewer, nil
}

func markBlockedAuthors(ctx context.Context, viewer *domain.Viewer, repos *infrastructure.Repos, authorIDs []uint64) error {
	if viewer == nil || viewer.ActorID == 0 || len(authorIDs) == 0 {
		return nil
	}
	blocked, err := blockedActorIDs(ctx, repos, viewer.ActorID, authorIDs)
	if err != nil {
		return err
	}
	if len(blocked) == 0 {
		return nil
	}
	if viewer.BlockedActors == nil {
		viewer.BlockedActors = make(map[uint64]struct{}, len(blocked))
	}
	for id, isBlocked := range blocked {
		if isBlocked {
			viewer.BlockedActors[id] = struct{}{}
			delete(viewer.Following, id)
		}
	}
	return nil
}

func blockedActorIDs(ctx context.Context, repos *infrastructure.Repos, actorID uint64, peerIDs []uint64) (map[uint64]bool, error) {
	if repos == nil || repos.Blocks == nil || actorID == 0 || len(peerIDs) == 0 {
		return map[uint64]bool{}, nil
	}
	unique := make([]uint64, 0, len(peerIDs))
	seen := make(map[uint64]struct{}, len(peerIDs))
	for _, id := range peerIDs {
		if id == 0 || id == actorID {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return map[uint64]bool{}, nil
	}
	return repos.Blocks.BlockedActorIDs(ctx, actorID, unique)
}
