package service

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/launcher/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

func GetPersonalizedFeed(ctx context.Context, userID string, limit int) (*model.GetFeedResponse, error) {
	logger.Infof(ctx, "fetching personalized feed for user: %s, limit: %d", userID, limit)

	items := []*model.FeedItem{
		{
			Id:        "chat_001",
			Type:      "recentActivity",
			Title:     "Recent Chat with Alice",
			Subtitle:  "Hey, are you free for a call later?",
			Timestamp: time.Now().Add(-10 * time.Minute).Unix(),
			Source:    "stationFeed",
		},
		{
			Id:        "chat_002",
			Type:      "recentActivity",
			Title:     "Team Discussion",
			Subtitle:  "Bob: The new feature is ready for review",
			Timestamp: time.Now().Add(-30 * time.Minute).Unix(),
			Source:    "stationFeed",
		},
		{
			Id:        "activity_001",
			Type:      "recentActivity",
			Title:     "Alice liked your post",
			Subtitle:  "Your post about decentralized social networks",
			Timestamp: time.Now().Add(-1 * time.Hour).Unix(),
			Source:    "stationFeed",
		},
		{
			Id:        "activity_002",
			Type:      "recentActivity",
			Title:     "Bob shared your article",
			Subtitle:  "Getting started with Peers-Touch",
			Timestamp: time.Now().Add(-2 * time.Hour).Unix(),
			Source:    "stationFeed",
		},
		{
			Id:        "activity_003",
			Type:      "recentActivity",
			Title:     "New follower: Charlie",
			Subtitle:  "Charlie started following you",
			Timestamp: time.Now().Add(-3 * time.Hour).Unix(),
			Source:    "stationFeed",
		},
		{
			Id:        "app_001",
			Type:      "recommendation",
			Title:     "Weather Widget",
			Subtitle:  "Check weather in your area - 4.5★",
			Timestamp: time.Now().Add(-4 * time.Hour).Unix(),
			Source:    "stationFeed",
		},
		{
			Id:        "app_002",
			Type:      "recommendation",
			Title:     "Task Manager",
			Subtitle:  "Organize your daily tasks - 4.8★",
			Timestamp: time.Now().Add(-5 * time.Hour).Unix(),
			Source:    "stationFeed",
		},
		{
			Id:        "plugin_001",
			Type:      "pluginContent",
			Title:     "AI Programming Assistant",
			Subtitle:  "New features for developers",
			Timestamp: time.Now().Add(-6 * time.Hour).Unix(),
			Source:    "stationFeed",
		},
		{
			Id:        "recommend_001",
			Type:      "recommendation",
			Title:     "Welcome to Peers-Touch",
			Subtitle:  "Get started with your decentralized social network",
			Timestamp: time.Now().Add(-24 * time.Hour).Unix(),
			Source:    "stationFeed",
		},
	}

	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}

	return &model.GetFeedResponse{
		Items: items,
	}, nil
}
