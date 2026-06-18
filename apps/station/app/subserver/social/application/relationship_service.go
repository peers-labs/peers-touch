package application

import (
	"context"
	"fmt"
	"strconv"

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

func (s *RelationshipService) Follow(ctx context.Context, followerID uint64, targetActorID string) (*model.Relationship, error) {
	followingID, err := strconv.ParseUint(targetActorID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid target actor ID: %w", err)
	}

	if followerID == followingID {
		return nil, fmt.Errorf("cannot follow yourself")
	}
	if blocked, err := s.isBlockedBetween(ctx, followerID, followingID); err != nil {
		return nil, err
	} else if blocked {
		return nil, fmt.Errorf("relationship is blocked")
	}
	if blocked, err := actorStationModerated(ctx, s.moderationRepo, followingID); err != nil {
		return nil, err
	} else if blocked {
		return nil, fmt.Errorf("target actor station is blocked")
	}

	logger.Info(ctx, "Follow", "followerID", followerID, "followingID", followingID)

	err = s.followRepo.Follow(ctx, followerID, followingID)
	if err != nil {
		logger.Error(ctx, "failed to follow", "error", err)
		return nil, err
	}

	relationship, err := s.GetRelationship(ctx, followerID, targetActorID)
	if err != nil {
		logger.Error(ctx, "failed to get relationship after follow", "error", err)
		return nil, err
	}

	return relationship, nil
}

func (s *RelationshipService) Unfollow(ctx context.Context, followerID uint64, targetActorID string) error {
	followingID, err := strconv.ParseUint(targetActorID, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid target actor ID: %w", err)
	}

	logger.Info(ctx, "Unfollow", "followerID", followerID, "followingID", followingID)

	err = s.followRepo.Unfollow(ctx, followerID, followingID)
	if err != nil {
		logger.Error(ctx, "failed to unfollow", "error", err)
		return err
	}

	return nil
}

func (s *RelationshipService) GetRelationship(ctx context.Context, followerID uint64, targetActorID string) (*model.Relationship, error) {
	followingID, err := strconv.ParseUint(targetActorID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid target actor ID: %w", err)
	}

	following, err := s.followRepo.IsFollowing(ctx, followerID, followingID)
	if err != nil {
		return nil, err
	}

	followedBy, err := s.followRepo.IsFollowing(ctx, followingID, followerID)
	if err != nil {
		return nil, err
	}
	if blocked, err := s.isBlockedBetween(ctx, followerID, followingID); err != nil {
		return nil, err
	} else if blocked {
		following = false
		followedBy = false
	}

	relationship := &model.Relationship{
		Id:            fmt.Sprintf("%d", followingID),
		TargetActorId: targetActorID,
		Following:     following,
		FollowedBy:    followedBy,
	}

	if following {
		follow, err := s.followRepo.GetRelationship(ctx, followerID, followingID)
		if err == nil && follow != nil {
			relationship.FollowedAt = timestamppb.New(follow.CreatedAt)
		}
	}

	return relationship, nil
}

func (s *RelationshipService) GetRelationships(ctx context.Context, followerID uint64, targetActorIDs []string) ([]*model.Relationship, error) {
	if len(targetActorIDs) == 0 {
		return []*model.Relationship{}, nil
	}

	targetIDs := make([]uint64, 0, len(targetActorIDs))
	idMap := make(map[uint64]string)

	for _, idStr := range targetActorIDs {
		id, err := strconv.ParseUint(idStr, 10, 64)
		if err != nil {
			logger.Warn(ctx, "invalid actor ID in batch", "id", idStr)
			continue
		}
		targetIDs = append(targetIDs, id)
		idMap[id] = idStr
	}

	followMap, err := s.followRepo.GetRelationships(ctx, followerID, targetIDs)
	if err != nil {
		return nil, err
	}
	followedByMap, err := s.followRepo.GetReverseRelationships(ctx, followerID, targetIDs)
	if err != nil {
		return nil, err
	}

	blockedMap, err := s.blockedActorIDs(ctx, followerID, targetIDs)
	if err != nil {
		return nil, err
	}

	relationships := make([]*model.Relationship, 0, len(targetIDs))
	for _, targetID := range targetIDs {
		follow := followMap[targetID]
		followedBy := followedByMap[targetID]
		if blockedMap[targetID] {
			follow = nil
			followedBy = false
		}

		relationship := &model.Relationship{
			Id:            fmt.Sprintf("%d", targetID),
			TargetActorId: idMap[targetID],
			Following:     follow != nil,
			FollowedBy:    followedBy,
		}

		if follow != nil {
			relationship.FollowedAt = timestamppb.New(follow.CreatedAt)
		}

		relationships = append(relationships, relationship)
	}

	return relationships, nil
}

func (s *RelationshipService) GetFollowers(ctx context.Context, actorID uint64, cursor string, limit int) ([]*model.Follower, string, int32, error) {
	var repoCursor infrastructure.Cursor
	if cursor != "" {
		if err := infrastructure.DecodeCursor(cursor, &repoCursor); err != nil {
			return nil, "", 0, fmt.Errorf("invalid cursor: %w", err)
		}
	}

	if limit <= 0 || limit > 100 {
		limit = 20
	}

	follows, err := s.followRepo.GetFollowers(ctx, actorID, repoCursor, limit+1)
	if err != nil {
		return nil, "", 0, err
	}

	hasMore := len(follows) > limit
	if hasMore {
		follows = follows[:limit]
	}

	followerIDs := make([]uint64, 0, len(follows))
	for _, follow := range follows {
		if follow.Follower != nil {
			followerIDs = append(followerIDs, follow.Follower.ID)
		}
	}
	blockedMap, err := s.blockedActorIDs(ctx, actorID, followerIDs)
	if err != nil {
		return nil, "", 0, err
	}

	followers := make([]*model.Follower, 0, len(follows))
	for _, follow := range follows {
		if follow.Follower == nil {
			continue
		}
		if blockedMap[follow.Follower.ID] {
			continue
		}

		follower := &model.Follower{
			ActorId:           fmt.Sprintf("%d", follow.Follower.ID),
			Username:          follow.Follower.PreferredUsername,
			DisplayName:       follow.Follower.Name,
			AvatarUrl:         getAvatarURL(follow.Follower),
			FollowedAt:        timestamppb.New(follow.CreatedAt),
			FederatedHandle:   federatedHandleOf(follow.Follower),
			HomeStationDomain: homeStationDomainOf(follow.Follower),
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

	total, err := s.followRepo.GetFollowerCount(ctx, actorID)
	if err != nil {
		logger.Warn(ctx, "failed to get follower count", "error", err)
		total = 0
	}

	return followers, nextCursor, int32(total), nil
}

func (s *RelationshipService) GetFollowing(ctx context.Context, actorID uint64, cursor string, limit int) ([]*model.Following, string, int32, error) {
	var repoCursor infrastructure.Cursor
	if cursor != "" {
		if err := infrastructure.DecodeCursor(cursor, &repoCursor); err != nil {
			return nil, "", 0, fmt.Errorf("invalid cursor: %w", err)
		}
	}

	if limit <= 0 || limit > 100 {
		limit = 20
	}

	follows, err := s.followRepo.GetFollowing(ctx, actorID, repoCursor, limit+1)
	if err != nil {
		return nil, "", 0, err
	}

	hasMore := len(follows) > limit
	if hasMore {
		follows = follows[:limit]
	}

	followingIDs := make([]uint64, 0, len(follows))
	for _, follow := range follows {
		if follow.Following != nil {
			followingIDs = append(followingIDs, follow.Following.ID)
		}
	}
	blockedMap, err := s.blockedActorIDs(ctx, actorID, followingIDs)
	if err != nil {
		return nil, "", 0, err
	}

	following := make([]*model.Following, 0, len(follows))
	for _, follow := range follows {
		if follow.Following == nil {
			continue
		}
		if blockedMap[follow.Following.ID] {
			continue
		}

		f := &model.Following{
			ActorId:           fmt.Sprintf("%d", follow.Following.ID),
			Username:          follow.Following.PreferredUsername,
			DisplayName:       follow.Following.Name,
			AvatarUrl:         getAvatarURL(follow.Following),
			FollowedAt:        timestamppb.New(follow.CreatedAt),
			FederatedHandle:   federatedHandleOf(follow.Following),
			HomeStationDomain: homeStationDomainOf(follow.Following),
		}
		logger.Info(ctx, "Following user", "actorId", f.ActorId, "username", f.Username, "displayName", f.DisplayName, "displayNameBytes", []byte(f.DisplayName))
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

	total, err := s.followRepo.GetFollowingCount(ctx, actorID)
	if err != nil {
		logger.Warn(ctx, "failed to get following count", "error", err)
		total = 0
	}

	return following, nextCursor, int32(total), nil
}

func (s *RelationshipService) isBlockedBetween(ctx context.Context, actorID, peerID uint64) (bool, error) {
	if s.blockRepo == nil {
		return false, nil
	}
	return s.blockRepo.IsBlockedBetween(ctx, actorID, peerID)
}

func (s *RelationshipService) blockedActorIDs(ctx context.Context, actorID uint64, peerIDs []uint64) (map[uint64]bool, error) {
	if s.blockRepo == nil {
		return map[uint64]bool{}, nil
	}
	return s.blockRepo.BlockedActorIDs(ctx, actorID, peerIDs)
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
	return a.FederatedHandle
}

// homeStationDomainOf returns the DNS-style HTTP origin (no scheme)
// of the actor's authoritative station. Empty for legacy rows.
func homeStationDomainOf(a *db.Actor) string {
	if a == nil {
		return ""
	}
	return a.HomeStationDomain
}
