package service

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/launcher/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

func SearchContent(ctx context.Context, query string, limit int) (*model.SearchResponse, error) {
	logger.Infof(ctx, "searching content with query: %s, limit: %d", query, limit)

	mockResults := []model.SearchResult{
		{
			ID:       "user_1",
			Type:     model.SearchResultTypeFriend,
			Title:    "Alice",
			Subtitle: "@alice@peers.com",
		},
		{
			ID:       "user_2",
			Type:     model.SearchResultTypeFriend,
			Title:    "Bob",
			Subtitle: "@bob@peers.org",
		},
		{
			ID:       "post_1",
			Type:     model.SearchResultTypePost,
			Title:    "How to setup Peers-Touch on your home server",
			Subtitle: "A comprehensive guide for beginners",
		},
		{
			ID:       "applet_1",
			Type:     model.SearchResultTypeApplet,
			Title:    "Weather Widget",
			Subtitle: "Check weather in your area",
		},
	}

	var results []model.SearchResult
	queryLower := strings.ToLower(query)

	for _, result := range mockResults {
		if strings.Contains(strings.ToLower(result.Title), queryLower) ||
			strings.Contains(strings.ToLower(result.Subtitle), queryLower) {
			results = append(results, result)
		}
	}

	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}

	return &model.SearchResponse{
		Results: results,
		Total:   len(results),
	}, nil
}
