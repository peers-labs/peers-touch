package application

import (
	"context"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
)

func buildInteractionVisibility(ctx context.Context, repos *infrastructure.Repos, viewerID, postAuthorID uint64) (domain.InteractionVisibility, error) {
	v := domain.InteractionVisibility{
		ViewerID:       viewerID,
		PostAuthorID:   postAuthorID,
		MutualActorIDs: make(map[uint64]struct{}),
	}
	if viewerID == 0 || repos == nil || repos.Follows == nil {
		return v, nil
	}

	following, err := repos.Follows.FollowingActorIDs(ctx, viewerID)
	if err != nil {
		return v, err
	}
	followers, err := repos.Follows.FollowerActorIDs(ctx, viewerID)
	if err != nil {
		return v, err
	}

	followingSet := make(map[uint64]struct{}, len(following))
	for _, id := range following {
		followingSet[id] = struct{}{}
	}
	for _, id := range followers {
		if _, ok := followingSet[id]; ok {
			v.MutualActorIDs[id] = struct{}{}
		}
	}
	return v, nil
}
