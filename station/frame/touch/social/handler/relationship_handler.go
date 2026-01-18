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

func Follow(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.FollowRequest{})
	if err != nil {
		logger.Error(c, "failed to bind request", "error", err)
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "invalid request"))
		return
	}

	if req.TargetActorId == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "target_actor_id is required"))
		return
	}

	logger.Info(c, "Follow request", "userID", userID, "targetActorId", req.TargetActorId)

	relationship, err := service.Follow(c, userID, req.TargetActorId)
	if err != nil {
		logger.Error(c, "failed to follow", "error", err, "userID", userID, "targetActorId", req.TargetActorId)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR, err.Error()))
		return
	}

	response := &model.FollowResponse{
		Success:      true,
		Relationship: relationship,
	}

	util.RspBack(c, ctx, http.StatusOK, response)
}

func Unfollow(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.UnfollowRequest{})
	if err != nil {
		return
	}

	if req.TargetActorId == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "target_actor_id is required"))
		return
	}

	err = service.Unfollow(c, userID, req.TargetActorId)
	if err != nil {
		logger.Error(c, "failed to unfollow", "error", err, "userID", userID, "targetActorId", req.TargetActorId)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR, err.Error()))
		return
	}

	response := &model.UnfollowResponse{
		Success: true,
	}

	util.RspBack(c, ctx, http.StatusOK, response)
}

func GetRelationship(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	targetActorId := ctx.Query("target_actor_id")
	if targetActorId == "" {
		util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "target_actor_id is required"))
		return
	}

	relationship, err := service.GetRelationship(c, userID, targetActorId)
	if err != nil {
		logger.Error(c, "failed to get relationship", "error", err, "userID", userID, "targetActorId", targetActorId)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR, err.Error()))
		return
	}

	response := &model.GetRelationshipResponse{
		Relationship: relationship,
	}

	util.RspBack(c, ctx, http.StatusOK, response)
}

func GetRelationships(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.GetRelationshipsRequest{})
	if err != nil {
		return
	}

	relationships, err := service.GetRelationships(c, userID, req.TargetActorIds)
	if err != nil {
		logger.Error(c, "failed to get relationships", "error", err, "userID", userID, "count", len(req.TargetActorIds))
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR, err.Error()))
		return
	}

	response := &model.GetRelationshipsResponse{
		Relationships: relationships,
	}

	util.RspBack(c, ctx, http.StatusOK, response)
}

func GetFollowers(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.GetFollowersRequest{})
	if err != nil {
		return
	}

	actorID := userID
	if req.ActorId != "" {
		actorID, err = strconv.ParseUint(req.ActorId, 10, 64)
		if err != nil {
			util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "invalid actor_id"))
			return
		}
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}

	followers, nextCursor, total, err := service.GetFollowers(c, actorID, req.Cursor, limit)
	if err != nil {
		logger.Error(c, "failed to get followers", "error", err, "actorID", actorID)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR, err.Error()))
		return
	}

	response := &model.GetFollowersResponse{
		Followers:  followers,
		NextCursor: nextCursor,
		Total:      total,
	}

	util.RspBack(c, ctx, http.StatusOK, response)
}

func GetFollowing(c context.Context, ctx *app.RequestContext) {
	userID, exists := getUserID(c)
	if !exists {
		util.RspError(c, ctx, http.StatusUnauthorized, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_UNAUTHORIZED))
		return
	}

	req, err := util.ReqBind(c, ctx, &model.GetFollowingRequest{})
	if err != nil {
		return
	}

	actorID := userID
	if req.ActorId != "" {
		actorID, err = strconv.ParseUint(req.ActorId, 10, 64)
		if err != nil {
			util.RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST, "invalid actor_id"))
			return
		}
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}

	following, nextCursor, total, err := service.GetFollowing(c, actorID, req.Cursor, limit)
	if err != nil {
		logger.Error(c, "failed to get following", "error", err, "actorID", actorID)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR, err.Error()))
		return
	}

	response := &model.GetFollowingResponse{
		Following:  following,
		NextCursor: nextCursor,
		Total:      total,
	}

	util.RspBack(c, ctx, http.StatusOK, response)
}
