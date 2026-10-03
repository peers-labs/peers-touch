package application

import (
	"context"
	"fmt"
	"strings"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type RelationshipService struct {
	followRepo     infrastructure.FollowRepository
	blockRepo      infrastructure.BlockGraphRepository
	moderationRepo domain.StationModerationRepository
}

func NewRelationshipService(
	followRepo infrastructure.FollowRepository,
	blockRepo infrastructure.BlockGraphRepository,
	moderationRepos ...domain.StationModerationRepository,
) *RelationshipService {
	var moderationRepo domain.StationModerationRepository
	if len(moderationRepos) > 0 {
		moderationRepo = moderationRepos[0]
	}
	return &RelationshipService{followRepo: followRepo, blockRepo: blockRepo, moderationRepo: moderationRepo}
}

func (s *RelationshipService) Follow(ctx context.Context, followerPTID, targetActorPTID string) (*model.Relationship, error) {
	if followerPTID == targetActorPTID {
		return nil, fmt.Errorf("cannot follow yourself")
	}
	if blocked, err := s.isBlockedBetween(ctx, followerPTID, targetActorPTID); err != nil {
		return nil, err
	} else if blocked {
		return nil, fmt.Errorf("relationship is blocked")
	}
	if blocked, err := actorStationModerated(ctx, s.moderationRepo, targetActorPTID); err != nil {
		return nil, err
	} else if blocked {
		return nil, fmt.Errorf("target actor station is blocked")
	}

	logger.Info(ctx, "Follow relationship accepted")

	err := s.followRepo.Follow(ctx, followerPTID, targetActorPTID)
	if err != nil {
		logger.Error(ctx, "failed to follow", "error", err)
		return nil, err
	}

	relationship, err := s.GetRelationship(ctx, followerPTID, targetActorPTID)
	if err != nil {
		logger.Error(ctx, "failed to get relationship after follow", "error", err)
		return nil, err
	}

	return relationship, nil
}

func (s *RelationshipService) Unfollow(ctx context.Context, followerPTID, targetActorPTID string) error {
	logger.Info(ctx, "Unfollow relationship accepted")

	err := s.followRepo.Unfollow(ctx, followerPTID, targetActorPTID)
	if err != nil {
		logger.Error(ctx, "failed to unfollow", "error", err)
		return err
	}

	return nil
}

func (s *RelationshipService) GetRelationship(ctx context.Context, followerPTID, targetActorPTID string) (*model.Relationship, error) {
	following, err := s.followRepo.IsFollowing(ctx, followerPTID, targetActorPTID)
	if err != nil {
		return nil, err
	}

	followedBy, err := s.followRepo.IsFollowing(ctx, targetActorPTID, followerPTID)
	if err != nil {
		return nil, err
	}
	if blocked, err := s.isBlockedBetween(ctx, followerPTID, targetActorPTID); err != nil {
		return nil, err
	} else if blocked {
		following = false
		followedBy = false
	}

	relationship := &model.Relationship{
		Id:              targetActorPTID,
		TargetActorPtid: targetActorPTID,
		Following:       following,
		FollowedBy:      followedBy,
	}

	if following {
		follow, err := s.followRepo.GetRelationship(ctx, followerPTID, targetActorPTID)
		if err == nil && follow != nil {
			relationship.FollowedAt = timestamppb.New(follow.CreatedAt)
		}
	}

	return relationship, nil
}

func (s *RelationshipService) GetRelationships(ctx context.Context, followerPTID string, targetActorPTIDs []string) ([]*model.Relationship, error) {
	if len(targetActorPTIDs) == 0 {
		return []*model.Relationship{}, nil
	}
	followMap, err := s.followRepo.GetRelationships(ctx, followerPTID, targetActorPTIDs)
	if err != nil {
		return nil, err
	}
	followedByMap, err := s.followRepo.GetReverseRelationships(ctx, followerPTID, targetActorPTIDs)
	if err != nil {
		return nil, err
	}

	blockedMap, err := s.blockedActorPTIDs(ctx, followerPTID, targetActorPTIDs)
	if err != nil {
		return nil, err
	}

	relationships := make([]*model.Relationship, 0, len(targetActorPTIDs))
	for _, targetActorPTID := range targetActorPTIDs {
		follow := followMap[targetActorPTID]
		followedBy := followedByMap[targetActorPTID]
		if blockedMap[targetActorPTID] {
			follow = nil
			followedBy = false
		}

		relationship := &model.Relationship{
			Id:              targetActorPTID,
			TargetActorPtid: targetActorPTID,
			Following:       follow != nil,
			FollowedBy:      followedBy,
		}

		if follow != nil {
			relationship.FollowedAt = timestamppb.New(follow.CreatedAt)
		}

		relationships = append(relationships, relationship)
	}

	return relationships, nil
}

func (s *RelationshipService) GetFollowers(ctx context.Context, actorPTID string, cursor string, limit int) ([]*model.Follower, string, int32, error) {
	var repoCursor infrastructure.Cursor
	if cursor != "" {
		if err := infrastructure.DecodeCursor(cursor, &repoCursor); err != nil {
			return nil, "", 0, fmt.Errorf("invalid cursor: %w", err)
		}
	}

	if limit <= 0 || limit > 100 {
		limit = 20
	}

	follows, err := s.followRepo.GetFollowers(ctx, actorPTID, repoCursor, limit+1)
	if err != nil {
		return nil, "", 0, err
	}

	hasMore := len(follows) > limit
	if hasMore {
		follows = follows[:limit]
	}

	followerPTIDs := make([]string, 0, len(follows))
	for _, follow := range follows {
		if follow.Follower != nil {
			followerPTIDs = append(followerPTIDs, follow.Follower.PTID)
		}
	}
	blockedMap, err := s.blockedActorPTIDs(ctx, actorPTID, followerPTIDs)
	if err != nil {
		return nil, "", 0, err
	}

	followers := make([]*model.Follower, 0, len(follows))
	for _, follow := range follows {
		if follow.Follower == nil {
			continue
		}
		if blockedMap[follow.Follower.PTID] {
			continue
		}

		follower := &model.Follower{
			ActorPtid:         follow.Follower.PTID,
			Username:          follow.Follower.PreferredUsername,
			DisplayName:       follow.Follower.Name,
			AvatarUrl:         getAvatarURL(follow.Follower),
			FollowedAt:        timestamppb.New(follow.CreatedAt),
			FederatedHandle:   federatedHandleOf(follow.Follower),
			HomeStationDomain: homeStationDomainOf(follow.Follower),
			HomeStationPeerId: homeStationPeerIDOf(follow.Follower),
		}
		followers = append(followers, follower)
	}

	var nextCursor string
	if hasMore && len(follows) > 0 {
		lastFollow := follows[len(follows)-1]
		nextCursor = infrastructure.EncodeCursor(&infrastructure.Cursor{
			CreatedAt: lastFollow.CreatedAt,
			LastID:    lastFollow.ID,
		})
	}

	total, err := s.followRepo.GetFollowerCount(ctx, actorPTID)
	if err != nil {
		logger.Warn(ctx, "failed to get follower count", "error", err)
		total = 0
	}

	return followers, nextCursor, int32(total), nil
}

func (s *RelationshipService) GetFollowing(ctx context.Context, actorPTID string, cursor string, limit int) ([]*model.Following, string, int32, error) {
	var repoCursor infrastructure.Cursor
	if cursor != "" {
		if err := infrastructure.DecodeCursor(cursor, &repoCursor); err != nil {
			return nil, "", 0, fmt.Errorf("invalid cursor: %w", err)
		}
	}

	if limit <= 0 || limit > 100 {
		limit = 20
	}

	follows, err := s.followRepo.GetFollowing(ctx, actorPTID, repoCursor, limit+1)
	if err != nil {
		return nil, "", 0, err
	}

	hasMore := len(follows) > limit
	if hasMore {
		follows = follows[:limit]
	}

	followingPTIDs := make([]string, 0, len(follows))
	for _, follow := range follows {
		if follow.Following != nil {
			followingPTIDs = append(followingPTIDs, follow.Following.PTID)
		}
	}
	blockedMap, err := s.blockedActorPTIDs(ctx, actorPTID, followingPTIDs)
	if err != nil {
		return nil, "", 0, err
	}

	following := make([]*model.Following, 0, len(follows))
	for _, follow := range follows {
		if follow.Following == nil {
			continue
		}
		if blockedMap[follow.Following.PTID] {
			continue
		}

		f := &model.Following{
			ActorPtid:         follow.Following.PTID,
			Username:          follow.Following.PreferredUsername,
			DisplayName:       follow.Following.Name,
			AvatarUrl:         getAvatarURL(follow.Following),
			FollowedAt:        timestamppb.New(follow.CreatedAt),
			FederatedHandle:   federatedHandleOf(follow.Following),
			HomeStationDomain: homeStationDomainOf(follow.Following),
			HomeStationPeerId: homeStationPeerIDOf(follow.Following),
		}
		following = append(following, f)
	}

	var nextCursor string
	if hasMore && len(follows) > 0 {
		lastFollow := follows[len(follows)-1]
		nextCursor = infrastructure.EncodeCursor(&infrastructure.Cursor{
			CreatedAt: lastFollow.CreatedAt,
			LastID:    lastFollow.ID,
		})
	}

	total, err := s.followRepo.GetFollowingCount(ctx, actorPTID)
	if err != nil {
		logger.Warn(ctx, "failed to get following count", "error", err)
		total = 0
	}

	return following, nextCursor, int32(total), nil
}

func (s *RelationshipService) isBlockedBetween(ctx context.Context, actorPTID, peerPTID string) (bool, error) {
	if s.blockRepo == nil {
		return false, nil
	}
	return s.blockRepo.IsBlockedBetween(ctx, actorPTID, peerPTID)
}

func (s *RelationshipService) blockedActorPTIDs(ctx context.Context, actorPTID string, peerPTIDs []string) (map[string]bool, error) {
	if s.blockRepo == nil {
		return map[string]bool{}, nil
	}
	return s.blockRepo.BlockedActorPTIDs(ctx, actorPTID, peerPTIDs)
}

func getAvatarURL(actor *db.Actor) string {
	return actor.Icon
}

// federatedHandleOf returns the canonical "@user@host" form for an
// actor, falling back to the empty string when the row pre-dates the
// federation backfill. Wire layer treats "" as "not federated yet" and
// renders just the local "@username".
//
// Kept inline (not a one-line accessor) so the social-graph hydrators
// have a single hook if/when we need to compute the handle from a
// remote_cached row whose `federated_handle` was lost during a manual
// migration.
func federatedHandleOf(a *db.Actor) string {
	if a == nil {
		return ""
	}
	handle := strings.TrimSpace(a.FederatedHandle)
	if handle == "" || strings.HasPrefix(handle, "@") {
		return handle
	}
	if !strings.Contains(handle, "@") {
		return ""
	}
	return "@" + handle
}

// homeStationDomainOf returns the DNS-style HTTP origin (no scheme)
// of the actor's authoritative station. Empty for legacy rows.
func homeStationDomainOf(a *db.Actor) string {
	if a == nil {
		return ""
	}
	return a.HomeStationDomain
}

// homeStationPeerIDOf returns the authoritative Station routing identity.
// Empty remains a valid projection for legacy rows pending backfill.
func homeStationPeerIDOf(a *db.Actor) string {
	if a == nil {
		return ""
	}
	return a.HomeStationPeerID
}
