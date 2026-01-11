package handler

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
)

func GetTimeline(c context.Context, ctx *app.RequestContext) {
	var req model.GetTimelineRequest
	if err := ctx.Bind(&req); err != nil {
		logger.Error(c, "failed to bind request", "error", err)
		ctx.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	var viewerID uint64
	if userID, exists := getUserID(c); exists {
		viewerID = userID
	}

	resp, err := service.GetTimeline(c, &req, viewerID)
	if err != nil {
		logger.Error(c, "failed to get timeline", "error", err)
		ctx.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	respondWithProto(c, ctx, http.StatusOK, resp)
}
