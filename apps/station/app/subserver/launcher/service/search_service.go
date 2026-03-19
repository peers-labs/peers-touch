package service

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/launcher/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

func SearchContent(ctx context.Context, query string, limit int) (*model.SearchResponse, error) {
	logger.Infof(ctx, "searching content with query: %s, limit: %d", query, limit)

	mockResults := []*model.SearchResult{
		{
			Id:       "user_001",
			Type:     "friend",
			Title:    "Alice Johnson",
			Subtitle: "@alice@peers.com · Friend",
		},
		{
			Id:       "user_002",
			Type:     "friend",
			Title:    "Bob Smith",
			Subtitle: "@bob@peers.org · Friend",
		},
		{
			Id:       "user_003",
			Type:     "friend",
			Title:    "Charlie Brown",
			Subtitle: "@charlie@social.example · Following",
		},
		{
			Id:       "chat_001",
			Type:     "post",
			Title:    "Team Discussion",
			Subtitle: "Last message: The new feature is ready for review",
		},
		{
			Id:       "chat_002",
			Type:     "post",
			Title:    "Project Planning",
			Subtitle: "Last message: Let's schedule a meeting for next week",
		},
		{
			Id:       "post_001",
			Type:     "post",
			Title:    "How to setup Peers-Touch on your home server",
			Subtitle: "A comprehensive guide for beginners · 15 likes",
		},
		{
			Id:       "post_002",
			Type:     "post",
			Title:    "Understanding ActivityPub Protocol",
			Subtitle: "Deep dive into federated social networks · 23 likes",
		},
		{
			Id:       "app_001",
			Type:     "applet",
			Title:    "Weather Widget",
			Subtitle: "Check weather in your area · 4.5★ · 1.2k installs",
		},
		{
			Id:       "app_002",
			Type:     "applet",
			Title:    "Task Manager",
			Subtitle: "Organize your daily tasks · 4.8★ · 3.5k installs",
		},
		{
			Id:       "app_003",
			Type:     "applet",
			Title:    "Note Taking App",
			Subtitle: "Simple and powerful notes · 4.6★ · 890 installs",
		},
		{
			Id:       "app_004",
			Type:     "applet",
			Title:    "Calendar Integration",
			Subtitle: "Sync your events · 4.7★ · 2.1k installs",
		},
	}

	var results []*model.SearchResult
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
		Total:   int32(len(results)),
	}, nil
}
