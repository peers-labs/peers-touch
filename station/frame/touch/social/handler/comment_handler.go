package handler

import (
	"context"
	"strconv"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
)

func HandleGetPostComments(ctx context.Context, req *model.GetCommentsRequest) (*model.GetCommentsResponse, error) {
	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	postID, err := strconv.ParseUint(req.PostId, 10, 64)
	if err != nil {
		return nil, server.BadRequest("invalid post_id")
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	comments, err := service.GetPostComments(ctx, postID, limit)
	if err != nil {
		logger.Error(ctx, "failed to get comments", "postID", req.PostId, "error", err)
		return nil, server.InternalErrorWithCause("failed to get comments", err)
	}

	return comments, nil
}

func HandleCreateComment(ctx context.Context, req *model.CreateCommentRequest) (*model.CreateCommentResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.PostId == "" {
		return nil, server.BadRequest("post_id is required")
	}

	postID, err := strconv.ParseUint(req.PostId, 10, 64)
	if err != nil {
		return nil, server.BadRequest("invalid post_id")
	}

	if req.Content == "" {
		return nil, server.BadRequest("content is required")
	}

	comment, err := service.CreateComment(ctx, req, postID, userID)
	if err != nil {
		logger.Error(ctx, "failed to create comment", "postID", req.PostId, "userID", userID, "error", err)
		return nil, server.InternalErrorWithCause("failed to create comment", err)
	}

	return &model.CreateCommentResponse{Comment: comment}, nil
}

func HandleDeleteComment(ctx context.Context, req *model.DeleteCommentRequest) (*model.DeleteCommentResponse, error) {
	userID, exists := getUserID(ctx)
	if !exists {
		return nil, server.Unauthorized("authentication required")
	}

	if req.CommentId == "" {
		return nil, server.BadRequest("comment_id is required")
	}

	commentID, err := strconv.ParseUint(req.CommentId, 10, 64)
	if err != nil {
		return nil, server.BadRequest("invalid comment_id")
	}

	err = service.DeleteComment(ctx, commentID, userID)
	if err != nil {
		logger.Error(ctx, "failed to delete comment", "commentID", req.CommentId, "userID", userID, "error", err)
		return nil, server.InternalErrorWithCause("failed to delete comment", err)
	}

	return &model.DeleteCommentResponse{Success: true}, nil
}
