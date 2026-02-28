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
	userID := req.UserId
	if userID == "" {
		userID = "default_user"
	}

	limit := int(req.Limit)
	if limit <= 0 {
		limit = 20
	}

	feed, err := service.GetPersonalizedFeed(ctx, userID, limit)
	if err != nil {
		logger.Error(ctx, "Failed to get personalized feed", "error", err)
		return nil, err
	}

	protoItems := make([]*model.FeedItem, 0, len(feed.Items))
	for _, item := range feed.Items {
		metadata := make(map[string]string)
		for k, v := range item.Metadata {
			if str, ok := v.(string); ok {
				metadata[k] = str
			}
		}

		protoItems = append(protoItems, &model.FeedItem{
			Id:        item.ID,
			Type:      string(item.Type),
			Title:     item.Title,
			Subtitle:  item.Subtitle,
			ImageUrl:  item.ImageURL,
			Timestamp: item.Timestamp.Unix(),
			Source:    string(item.Source),
			Metadata:  metadata,
		})
	}

	return &model.GetFeedResponse{
		Items: protoItems,
	}, nil
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

	results, err := service.SearchContent(ctx, req.Query, limit)
	if err != nil {
		logger.Error(ctx, "Failed to search content", "error", err)
		return nil, err
	}

	protoResults := make([]*model.SearchResult, 0, len(results.Results))
	for _, result := range results.Results {
		metadata := make(map[string]string)
		for k, v := range result.Metadata {
			if str, ok := v.(string); ok {
				metadata[k] = str
			}
		}

		protoResults = append(protoResults, &model.SearchResult{
			Id:        result.ID,
			Type:      string(result.Type),
			Title:     result.Title,
			Subtitle:  result.Subtitle,
			ImageUrl:  result.ImageURL,
			ActionUrl: result.ActionURL,
			Metadata:  metadata,
		})
	}

	return &model.SearchResponse{
		Results: protoResults,
		Total:   int32(results.Total),
	}, nil
}

type searchError struct {
	message string
}

func (e *searchError) Error() string {
	return e.message
}
