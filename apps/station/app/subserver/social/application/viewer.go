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
//     posts. Membership is keyed by PTID; we resolve the viewer's PTID
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
	viewerPTID string,
	repos *infrastructure.Repos,
	groups domain.GroupMembershipChecker,
) (domain.Viewer, error) {
	if viewerPTID == "" {
		return domain.Viewer{}, nil
	}

	v := domain.Viewer{ActorPTID: viewerPTID}

	followingPTIDs, err := repos.Follows.FollowingActorPTIDs(ctx, viewerPTID)
	if err != nil {
		return domain.Viewer{}, err
	}
	blockedFollowing, err := blockedActorPTIDs(ctx, repos, viewerPTID, followingPTIDs)
	if err != nil {
		return domain.Viewer{}, err
	}
	if len(followingPTIDs) > 0 {
		v.Following = make(map[string]struct{}, len(followingPTIDs))
		for _, ptid := range followingPTIDs {
			if blockedFollowing[ptid] {
				continue
			}
			v.Following[ptid] = struct{}{}
		}
	}
	if len(blockedFollowing) > 0 {
		v.BlockedActors = make(map[string]struct{}, len(blockedFollowing))
		for ptid, blocked := range blockedFollowing {
			if blocked {
				v.BlockedActors[ptid] = struct{}{}
			}
		}
	}

	if v.ActorPTID != "" {
		circleIDs, err := repos.Circles.MembershipsForViewer(ctx, v.ActorPTID)
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
		groupIDs, err := groups.MembershipsForViewer(ctx, viewerPTID)
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
	viewerPTID string,
	repos *infrastructure.Repos,
	groups domain.GroupMembershipChecker,
	authorPTIDs []string,
) (domain.Viewer, error) {
	viewer, err := buildViewer(ctx, viewerPTID, repos, groups)
	if err != nil {
		return domain.Viewer{}, err
	}
	if err := markBlockedAuthors(ctx, &viewer, repos, authorPTIDs); err != nil {
		return domain.Viewer{}, err
	}
	return viewer, nil
}

func markBlockedAuthors(ctx context.Context, viewer *domain.Viewer, repos *infrastructure.Repos, authorPTIDs []string) error {
	if viewer == nil || viewer.ActorPTID == "" || len(authorPTIDs) == 0 {
		return nil
	}
	blocked, err := blockedActorPTIDs(ctx, repos, viewer.ActorPTID, authorPTIDs)
	if err != nil {
		return err
	}
	if len(blocked) == 0 {
		return nil
	}
	if viewer.BlockedActors == nil {
		viewer.BlockedActors = make(map[string]struct{}, len(blocked))
	}
	for ptid, isBlocked := range blocked {
		if isBlocked {
			viewer.BlockedActors[ptid] = struct{}{}
			delete(viewer.Following, ptid)
		}
	}
	return nil
}

func blockedActorPTIDs(ctx context.Context, repos *infrastructure.Repos, actorPTID string, peerPTIDs []string) (map[string]bool, error) {
	if repos == nil || repos.Blocks == nil || actorPTID == "" || len(peerPTIDs) == 0 {
		return map[string]bool{}, nil
	}
	unique := make([]string, 0, len(peerPTIDs))
	seen := make(map[string]struct{}, len(peerPTIDs))
	for _, ptid := range peerPTIDs {
		if ptid == "" || ptid == actorPTID {
			continue
		}
		if _, ok := seen[ptid]; ok {
			continue
		}
		seen[ptid] = struct{}{}
		unique = append(unique, ptid)
	}
	if len(unique) == 0 {
		return map[string]bool{}, nil
	}
	return repos.Blocks.BlockedActorPTIDs(ctx, actorPTID, unique)
}
