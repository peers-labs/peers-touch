package application

import (
	"context"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
)

func buildInteractionVisibility(ctx context.Context, repos *infrastructure.Repos, viewerPTID, postAuthorPTID string) (domain.InteractionVisibility, error) {
	v := domain.InteractionVisibility{
		ViewerPTID:       viewerPTID,
		PostAuthorPTID:   postAuthorPTID,
		MutualActorPTIDs: make(map[string]struct{}),
	}
	if viewerPTID == "" || repos == nil || repos.Follows == nil {
		return v, nil
	}

	following, err := repos.Follows.FollowingActorPTIDs(ctx, viewerPTID)
	if err != nil {
		return v, err
	}
	followers, err := repos.Follows.FollowerActorPTIDs(ctx, viewerPTID)
	if err != nil {
		return v, err
	}

	followingSet := make(map[string]struct{}, len(following))
	for _, ptid := range following {
		followingSet[ptid] = struct{}{}
	}
	for _, ptid := range followers {
		if _, ok := followingSet[ptid]; ok {
			v.MutualActorPTIDs[ptid] = struct{}{}
		}
	}
	return v, nil
}
