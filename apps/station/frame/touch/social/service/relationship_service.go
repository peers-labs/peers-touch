package service

import (
	"context"
	"fmt"
	"strconv"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var followRepo repository.FollowRepository

func initFollowRepo() {
	if gormDB != nil && followRepo == nil {
		followRepo = repository.NewFollowRepository(gormDB)
		logger.Info(context.Background(), "Follow repository initialized")
	}
}

func Follow(ctx context.Context, followerID uint64, targetActorID string) (*model.Relationship, error) {
	initFollowRepo()

	followingID, err := strconv.ParseUint(targetActorID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid target actor ID: %w", err)
	}

	if followerID == followingID {
		return nil, fmt.Errorf("cannot follow yourself")
	}

	logger.Info(ctx, "Follow", "followerID", followerID, "followingID", followingID)

	err = followRepo.Follow(ctx, followerID, followingID)
	if err != nil {
		logger.Error(ctx, "failed to follow", "error", err)
		return nil, err
	}

	relationship, err := GetRelationship(ctx, followerID, targetActorID)
	if err != nil {
		logger.Error(ctx, "failed to get relationship after follow", "error", err)
		return nil, err
	}

	return relationship, nil
}

func Unfollow(ctx context.Context, followerID uint64, targetActorID string) error {
	initFollowRepo()

	followingID, err := strconv.ParseUint(targetActorID, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid target actor ID: %w", err)
	}

	logger.Info(ctx, "Unfollow", "followerID", followerID, "followingID", followingID)

	err = followRepo.Unfollow(ctx, followerID, followingID)
	if err != nil {
		logger.Error(ctx, "failed to unfollow", "error", err)
		return err
	}

	return nil
}

func GetRelationship(ctx context.Context, followerID uint64, targetActorID string) (*model.Relationship, error) {
	initFollowRepo()

	followingID, err := strconv.ParseUint(targetActorID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid target actor ID: %w", err)
	}

	following, err := followRepo.IsFollowing(ctx, followerID, followingID)
	if err != nil {
		return nil, err
	}

	followedBy, err := followRepo.IsFollowing(ctx, followingID, followerID)
	if err != nil {
		return nil, err
	}

	relationship := &model.Relationship{
		Id:            fmt.Sprintf("%d", followingID),
		TargetActorId: targetActorID,
		Following:     following,
		FollowedBy:    followedBy,
	}

	if following {
		follow, err := followRepo.GetRelationship(ctx, followerID, followingID)
		if err == nil && follow != nil {
			relationship.FollowedAt = timestamppb.New(follow.CreatedAt)
		}
	}

	return relationship, nil
}

func GetRelationships(ctx context.Context, followerID uint64, targetActorIDs []string) ([]*model.Relationship, error) {
	initFollowRepo()

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

	followMap, err := followRepo.GetRelationships(ctx, followerID, targetIDs)
	if err != nil {
		return nil, err
	}

	reverseFollowMap, err := followRepo.GetRelationships(ctx, 0, []uint64{followerID})
	if err != nil {
		return nil, err
	}

	relationships := make([]*model.Relationship, 0, len(targetIDs))
	for _, targetID := range targetIDs {
		follow := followMap[targetID]
		reverseFollow := reverseFollowMap[followerID]

		relationship := &model.Relationship{
			Id:            fmt.Sprintf("%d", targetID),
			TargetActorId: idMap[targetID],
			Following:     follow != nil,
			FollowedBy:    reverseFollow != nil,
		}

		if follow != nil {
			relationship.FollowedAt = timestamppb.New(follow.CreatedAt)
		}

		relationships = append(relationships, relationship)
	}

	return relationships, nil
}

func GetFollowers(ctx context.Context, actorID uint64, cursor string, limit int) ([]*model.Follower, string, int32, error) {
	initFollowRepo()

	var repoCursor *repository.Cursor
	if cursor != "" {
		repoCursor = &repository.Cursor{}
		if err := repository.DecodeCursor(cursor, repoCursor); err != nil {
			return nil, "", 0, fmt.Errorf("invalid cursor: %w", err)
		}
	}

	if limit <= 0 || limit > 100 {
		limit = 20
	}

	follows, err := followRepo.GetFollowers(ctx, actorID, repoCursor, limit+1)
	if err != nil {
		return nil, "", 0, err
	}

	hasMore := len(follows) > limit
	if hasMore {
		follows = follows[:limit]
	}

	followers := make([]*model.Follower, 0, len(follows))
	for _, follow := range follows {
		if follow.Follower == nil {
			continue
		}

		follower := &model.Follower{
			ActorId:     fmt.Sprintf("%d", follow.Follower.ID),
			Username:    follow.Follower.PreferredUsername,
			DisplayName: follow.Follower.Name,
			AvatarUrl:   getAvatarURL(follow.Follower),
			FollowedAt:  timestamppb.New(follow.CreatedAt),
		}
		followers = append(followers, follower)
	}

	var nextCursor string
	if hasMore && len(follows) > 0 {
		lastFollow := follows[len(follows)-1]
		nextCursor = repository.EncodeCursor(&repository.Cursor{
			CreatedAt: lastFollow.CreatedAt,
			ID:        lastFollow.ID,
		})
	}

	total, err := followRepo.GetFollowerCount(ctx, actorID)
	if err != nil {
		logger.Warn(ctx, "failed to get follower count", "error", err)
		total = 0
	}

	return followers, nextCursor, int32(total), nil
}

func GetFollowing(ctx context.Context, actorID uint64, cursor string, limit int) ([]*model.Following, string, int32, error) {
	initFollowRepo()

	var repoCursor *repository.Cursor
	if cursor != "" {
		repoCursor = &repository.Cursor{}
		if err := repository.DecodeCursor(cursor, repoCursor); err != nil {
			return nil, "", 0, fmt.Errorf("invalid cursor: %w", err)
		}
	}

	if limit <= 0 || limit > 100 {
		limit = 20
	}

	follows, err := followRepo.GetFollowing(ctx, actorID, repoCursor, limit+1)
	if err != nil {
		return nil, "", 0, err
	}

	hasMore := len(follows) > limit
	if hasMore {
		follows = follows[:limit]
	}

	following := make([]*model.Following, 0, len(follows))
	for _, follow := range follows {
		if follow.Following == nil {
			continue
		}

		f := &model.Following{
			ActorId:     fmt.Sprintf("%d", follow.Following.ID),
			Username:    follow.Following.PreferredUsername,
			DisplayName: follow.Following.Name,
			AvatarUrl:   getAvatarURL(follow.Following),
			FollowedAt:  timestamppb.New(follow.CreatedAt),
		}
		logger.Info(ctx, "Following user", "actorId", f.ActorId, "username", f.Username, "displayName", f.DisplayName, "displayNameBytes", []byte(f.DisplayName))
		following = append(following, f)
	}

	var nextCursor string
	if hasMore && len(follows) > 0 {
		lastFollow := follows[len(follows)-1]
		nextCursor = repository.EncodeCursor(&repository.Cursor{
			CreatedAt: lastFollow.CreatedAt,
			ID:        lastFollow.ID,
		})
	}

	total, err := followRepo.GetFollowingCount(ctx, actorID)
	if err != nil {
		logger.Warn(ctx, "failed to get following count", "error", err)
		total = 0
	}

	return following, nextCursor, int32(total), nil
}

func getAvatarURL(actor *db.Actor) string {
	return actor.Icon
}
