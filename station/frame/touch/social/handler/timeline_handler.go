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

func GetTimeline(c context.Context, ctx *app.RequestContext) {
	var req model.GetTimelineRequest

	// Parse query parameters manually since Proto doesn't have query tags
	if typeStr := ctx.Query("type"); typeStr != "" {
		if typeInt, err := strconv.Atoi(typeStr); err == nil {
			req.Type = model.TimelineType(typeInt)
		}
	}
	req.Cursor = ctx.Query("cursor")
	if limitStr := ctx.Query("limit"); limitStr != "" {
		if limitInt, err := strconv.Atoi(limitStr); err == nil {
			req.Limit = int32(limitInt)
		}
	}
	req.UserId = ctx.Query("user_id")

	logger.Info(c, "[GetTimeline] Request received", "type", req.Type, "limit", req.Limit, "cursor", req.Cursor)

	var viewerID uint64
	if userID, exists := getUserID(c); exists {
		viewerID = userID
		logger.Info(c, "[GetTimeline] Viewer authenticated", "viewerID", viewerID)
	} else {
		logger.Info(c, "[GetTimeline] No authentication")
	}

	resp, err := service.GetTimeline(c, &req, viewerID)
	if err != nil {
		logger.Error(c, "failed to get timeline", "error", err)
		util.RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_GET_TIMELINE_FAILED, err.Error()))
		return
	}

	logger.Info(c, "[GetTimeline] Response ready", "postsCount", len(resp.Posts), "hasMore", resp.HasMore)
	util.RspBack(c, ctx, http.StatusOK, resp)
}
