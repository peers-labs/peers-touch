package handler

import (
	"context"
	"strconv"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
)

func HandleFollow(ctx context.Context, req *model.FollowRequest) (*model.FollowResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}

	logger.Info(ctx, "Follow request", "userID", userID, "targetActorId", req.TargetActorId)

	relationship, err := service.Follow(ctx, userID, req.TargetActorId)
	if err != nil {
		logger.Error(ctx, "failed to follow", "error", err, "userID", userID, "targetActorId", req.TargetActorId)
		return nil, server.InternalErrorWithCause("failed to follow", err)
	}

	return &model.FollowResponse{
		Success:      true,
		Relationship: relationship,
	}, nil
}

func HandleUnfollow(ctx context.Context, req *model.UnfollowRequest) (*model.UnfollowResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}

	err := service.Unfollow(ctx, userID, req.TargetActorId)
	if err != nil {
		logger.Error(ctx, "failed to unfollow", "error", err, "userID", userID, "targetActorId", req.TargetActorId)
		return nil, server.InternalErrorWithCause("failed to unfollow", err)
	}

	return &model.UnfollowResponse{
		Success: true,
	}, nil
}

func HandleGetRelationship(ctx context.Context, req *model.GetRelationshipRequest) (*model.GetRelationshipResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.TargetActorId == "" {
		return nil, server.BadRequest("target_actor_id is required")
	}

	relationship, err := service.GetRelationship(ctx, userID, req.TargetActorId)
	if err != nil {
		logger.Error(ctx, "failed to get relationship", "error", err, "userID", userID, "targetActorId", req.TargetActorId)
		return nil, server.InternalErrorWithCause("failed to get relationship", err)
	}

	return &model.GetRelationshipResponse{
		Relationship: relationship,
	}, nil
}

func HandleGetRelationships(ctx context.Context, req *model.GetRelationshipsRequest) (*model.GetRelationshipsResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	relationships, err := service.GetRelationships(ctx, userID, req.TargetActorIds)
	if err != nil {
		logger.Error(ctx, "failed to get relationships", "error", err, "userID", userID, "count", len(req.TargetActorIds))
		return nil, server.InternalErrorWithCause("failed to get relationships", err)
	}

	return &model.GetRelationshipsResponse{
		Relationships: relationships,
	}, nil
}

func HandleGetFollowers(ctx context.Context, req *model.GetFollowersRequest) (*model.GetFollowersResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	actorID := userID
	if req.ActorId != "" {
		var err error
		actorID, err = strconv.ParseUint(req.ActorId, 10, 64)
		if err != nil {
			return nil, server.BadRequest("invalid actor_id")
		}
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}

	followers, nextCursor, total, err := service.GetFollowers(ctx, actorID, req.Cursor, limit)
	if err != nil {
		logger.Error(ctx, "failed to get followers", "error", err, "actorID", actorID)
		return nil, server.InternalErrorWithCause("failed to get followers", err)
	}

	return &model.GetFollowersResponse{
		Followers:  followers,
		NextCursor: nextCursor,
		Total:      total,
	}, nil
}

func HandleGetFollowing(ctx context.Context, req *model.GetFollowingRequest) (*model.GetFollowingResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	actorID := userID
	if req.ActorId != "" {
		var err error
		actorID, err = strconv.ParseUint(req.ActorId, 10, 64)
		if err != nil {
			return nil, server.BadRequest("invalid actor_id")
		}
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}

	following, nextCursor, total, err := service.GetFollowing(ctx, actorID, req.Cursor, limit)
	if err != nil {
		logger.Error(ctx, "failed to get following", "error", err, "actorID", actorID)
		return nil, server.InternalErrorWithCause("failed to get following", err)
	}

	return &model.GetFollowingResponse{
		Following:  following,
		NextCursor: nextCursor,
		Total:      total,
	}, nil
}
