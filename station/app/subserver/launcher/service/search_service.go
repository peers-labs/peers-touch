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
			ID:       "user_001",
			Type:     model.SearchResultTypeFriend,
			Title:    "Alice Johnson",
			Subtitle: "@alice@peers.com · Friend",
		},
		{
			ID:       "user_002",
			Type:     model.SearchResultTypeFriend,
			Title:    "Bob Smith",
			Subtitle: "@bob@peers.org · Friend",
		},
		{
			ID:       "user_003",
			Type:     model.SearchResultTypeFriend,
			Title:    "Charlie Brown",
			Subtitle: "@charlie@social.example · Following",
		},
		{
			ID:       "chat_001",
			Type:     model.SearchResultTypePost,
			Title:    "Team Discussion",
			Subtitle: "Last message: The new feature is ready for review",
		},
		{
			ID:       "chat_002",
			Type:     model.SearchResultTypePost,
			Title:    "Project Planning",
			Subtitle: "Last message: Let's schedule a meeting for next week",
		},
		{
			ID:       "post_001",
			Type:     model.SearchResultTypePost,
			Title:    "How to setup Peers-Touch on your home server",
			Subtitle: "A comprehensive guide for beginners · 15 likes",
		},
		{
			ID:       "post_002",
			Type:     model.SearchResultTypePost,
			Title:    "Understanding ActivityPub Protocol",
			Subtitle: "Deep dive into federated social networks · 23 likes",
		},
		{
			ID:       "app_001",
			Type:     model.SearchResultTypeApplet,
			Title:    "Weather Widget",
			Subtitle: "Check weather in your area · 4.5★ · 1.2k installs",
		},
		{
			ID:       "app_002",
			Type:     model.SearchResultTypeApplet,
			Title:    "Task Manager",
			Subtitle: "Organize your daily tasks · 4.8★ · 3.5k installs",
		},
		{
			ID:       "app_003",
			Type:     model.SearchResultTypeApplet,
			Title:    "Note Taking App",
			Subtitle: "Simple and powerful notes · 4.6★ · 890 installs",
		},
		{
			ID:       "app_004",
			Type:     model.SearchResultTypeApplet,
			Title:    "Calendar Integration",
			Subtitle: "Sync your events · 4.7★ · 2.1k installs",
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
