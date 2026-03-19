package handler

import (
	"context"
	"strconv"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
)

func getUserID(c context.Context) (uint64, bool) {
	if subject := coreauth.GetSubject(c); subject != nil {
		userID, err := strconv.ParseUint(subject.ID, 10, 64)
		if err != nil {
			return 0, false
		}
		return userID, true
	}
	return 0, false
}

func HandleCreatePost(ctx context.Context, req *model.CreatePostRequest) (*model.CreatePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	post, err := service.CreatePost(ctx, req, userID)
	if err != nil {
		logger.Error(ctx, "failed to create post", "error", err)
		return nil, server.InternalErrorWithCause("failed to create post", err)
	}

	return &model.CreatePostResponse{Post: post}, nil
}

func HandleGetPost(ctx context.Context, req *model.GetPostRequest) (*model.GetPostResponse, error) {
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	var viewerID uint64
	if userID, exists := getUserID(ctx); exists {
		viewerID = userID
	}

	post, err := service.GetPost(ctx, req.PostId, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to get post", "error", err)
		return nil, server.NotFound("post not found")
	}

	return &model.GetPostResponse{Post: post}, nil
}

func HandleUpdatePost(ctx context.Context, req *model.UpdatePostRequest) (*model.UpdatePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	post, err := service.UpdatePost(ctx, req, userID)
	if err != nil {
		logger.Error(ctx, "failed to update post", "error", err)
		return nil, server.InternalErrorWithCause("failed to update post", err)
	}

	return &model.UpdatePostResponse{Post: post}, nil
}

func HandleDeletePost(ctx context.Context, req *model.DeletePostRequest) (*model.DeletePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	err := service.DeletePost(ctx, req.PostId, userID)
	if err != nil {
		logger.Error(ctx, "failed to delete post", "error", err)
		return nil, server.InternalErrorWithCause("failed to delete post", err)
	}

	return &model.DeletePostResponse{Success: true}, nil
}

func HandleLikePost(ctx context.Context, req *model.LikePostRequest) (*model.LikePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	resp, err := service.LikePost(ctx, req.PostId, userID)
	if err != nil {
		logger.Error(ctx, "failed to like post", "error", err)
		return nil, server.InternalErrorWithCause("failed to like post", err)
	}

	return resp, nil
}

func HandleUnlikePost(ctx context.Context, req *model.UnlikePostRequest) (*model.UnlikePostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	resp, err := service.UnlikePost(ctx, req.PostId, userID)
	if err != nil {
		logger.Error(ctx, "failed to unlike post", "error", err)
		return nil, server.InternalErrorWithCause("failed to unlike post", err)
	}

	return resp, nil
}

func HandleGetPostLikers(ctx context.Context, req *model.GetPostLikersRequest) (*model.GetPostLikersResponse, error) {
	resp, err := service.GetPostLikers(ctx, req)
	if err != nil {
		logger.Error(ctx, "failed to get post likers", "error", err)
		return nil, server.InternalErrorWithCause("failed to get post likers", err)
	}

	return resp, nil
}

func HandleRepostPost(ctx context.Context, req *model.RepostRequest) (*model.RepostResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	resp, err := service.RepostPost(ctx, req, userID)
	if err != nil {
		logger.Error(ctx, "failed to repost", "error", err)
		return nil, server.InternalErrorWithCause("failed to repost", err)
	}

	return resp, nil
}

func HandleGetUserPosts(ctx context.Context, req *model.ListPostsRequest) (*model.ListPostsResponse, error) {
	if req.Filter == nil {
		req.Filter = &model.PostFilter{}
	}

	authorID := req.Filter.AuthorId
	if authorID == "" {
		return nil, server.BadRequest("author_id is required")
	}

	if _, err := strconv.ParseUint(authorID, 10, 64); err != nil {
		actorInfo, err := actor.GetActorByUsername(ctx, authorID)
		if err != nil {
			logger.Warn(ctx, "failed to resolve username to actor ID", "username", authorID, "error", err)
			return nil, server.NotFound("user not found")
		}
		authorID = strconv.FormatUint(actorInfo.ID, 10)
		req.Filter.AuthorId = authorID
		logger.Debug(ctx, "resolved username to actor ID", "username", authorID, "actorID", authorID)
	}

	var viewerID uint64
	if vID, exists := getUserID(ctx); exists {
		viewerID = vID
	}

	resp, err := service.ListPosts(ctx, req, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to get user posts", "error", err)
		return nil, server.InternalErrorWithCause("failed to get user posts", err)
	}

	return resp, nil
}
