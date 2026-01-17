package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
	"github.com/peers-labs/peers-touch/station/frame/touch/util"
)

func GetPostComments(c context.Context, ctx *app.RequestContext) {
	postIDStr := ctx.Param("id")
	logger.Debug(c, "GetPostComments: received postId param", "postIDStr", postIDStr)
	postID, err := strconv.ParseUint(postIDStr, 10, 64)
	if err != nil {
		logger.Error(c, "GetPostComments: failed to parse postId", "postIDStr", postIDStr, "error", err)
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "invalid post ID"))
		return
	}

	limit := 20
	if limitStr := ctx.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	comments, err := service.GetPostComments(c, postID, limit)
	if err != nil {
		logger.Error(c, "failed to get comments", "postID", postID, "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_GET_COMMENTS_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, comments)
}

func CreateComment(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	postIDStr := ctx.Param("id")
	postID, err := strconv.ParseUint(postIDStr, 10, 64)
	if err != nil {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "invalid post ID"))
		return
	}

	var req model.CreateCommentRequest
	if err := ctx.BindJSON(&req); err != nil {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST_BODY, err.Error()))
		return
	}

	comment, err := service.CreateComment(c, &req, postID, userID)
	if err != nil {
		logger.Error(c, "failed to create comment", "postID", postID, "userID", userID, "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_CREATE_COMMENT_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, &model.CreateCommentResponse{Comment: comment})
}

func DeleteComment(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	commentIDStr := ctx.Param("commentId")
	commentID, err := strconv.ParseUint(commentIDStr, 10, 64)
	if err != nil {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "invalid comment ID"))
		return
	}

	err = service.DeleteComment(c, commentID, userID)
	if err != nil {
		logger.Error(c, "failed to delete comment", "commentID", commentID, "userID", userID, "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_DELETE_COMMENT_FAILED, err.Error()))
		return
	}

	util.RspBack(c, ctx, http.StatusOK, &model.DeleteCommentResponse{Success: true})
}
