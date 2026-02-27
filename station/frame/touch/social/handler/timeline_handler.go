package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
)

func HandleGetTimeline(ctx context.Context, req *model.GetTimelineRequest) (*model.GetTimelineResponse, error) {
	logger.Info(ctx, "[GetTimeline] Request received", "type", req.Type, "limit", req.Limit, "cursor", req.Cursor)

	var viewerID uint64
	if userID, exists := getUserID(ctx); exists {
		viewerID = userID
		logger.Info(ctx, "[GetTimeline] Viewer authenticated", "viewerID", viewerID)
	} else {
		logger.Info(ctx, "[GetTimeline] No authentication")
	}

	resp, err := service.GetTimeline(ctx, req, viewerID)
	if err != nil {
		logger.Error(ctx, "failed to get timeline", "error", err)
		return nil, server.InternalErrorWithCause("failed to get timeline", err)
	}

	logger.Info(ctx, "[GetTimeline] Response ready", "postsCount", len(resp.Posts), "hasMore", resp.HasMore)
	return resp, nil
}
