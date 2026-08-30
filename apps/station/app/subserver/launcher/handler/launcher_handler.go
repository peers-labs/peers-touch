package handler

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/launcher/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/launcher/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

type LauncherHandlers struct{}

func NewLauncherHandlers() *LauncherHandlers {
	return &LauncherHandlers{}
}

func (h *LauncherHandlers) HandleGetFeed(ctx context.Context, req *model.GetFeedRequest) (*model.GetFeedResponse, error) {
	actorPTID := req.GetActorPtid()
	if actorPTID == "" {
		return nil, &searchError{message: "actor_ptid is required"}
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}

	return service.GetPersonalizedFeed(ctx, actorPTID, limit)
}

func (h *LauncherHandlers) HandleSearch(ctx context.Context, req *model.SearchRequest) (*model.SearchResponse, error) {
	if req.Query == "" {
		logger.Error(ctx, "Missing query in search request")
		return nil, &searchError{message: "query parameter is required"}
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 10
	}

	return service.SearchContent(ctx, req.Query, limit)
}

type searchError struct {
	message string
}

func (e *searchError) Error() string {
	return e.message
}
