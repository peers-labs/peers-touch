package service

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/launcher/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

func GetPersonalizedFeed(ctx context.Context, userID string, limit int) (*model.FeedResponse, error) {
	logger.Infof(ctx, "fetching personalized feed for user: %s, limit: %d", userID, limit)

	items := []model.FeedItem{
		{
			ID:        "chat_001",
			Type:      model.FeedItemTypeRecentActivity,
			Title:     "Recent Chat with Alice",
			Subtitle:  "Hey, are you free for a call later?",
			Timestamp: time.Now().Add(-10 * time.Minute),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "chat_002",
			Type:      model.FeedItemTypeRecentActivity,
			Title:     "Team Discussion",
			Subtitle:  "Bob: The new feature is ready for review",
			Timestamp: time.Now().Add(-30 * time.Minute),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "activity_001",
			Type:      model.FeedItemTypeRecentActivity,
			Title:     "Alice liked your post",
			Subtitle:  "Your post about decentralized social networks",
			Timestamp: time.Now().Add(-1 * time.Hour),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "activity_002",
			Type:      model.FeedItemTypeRecentActivity,
			Title:     "Bob shared your article",
			Subtitle:  "Getting started with Peers-Touch",
			Timestamp: time.Now().Add(-2 * time.Hour),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "activity_003",
			Type:      model.FeedItemTypeRecentActivity,
			Title:     "New follower: Charlie",
			Subtitle:  "Charlie started following you",
			Timestamp: time.Now().Add(-3 * time.Hour),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "app_001",
			Type:      model.FeedItemTypeRecommendation,
			Title:     "Weather Widget",
			Subtitle:  "Check weather in your area - 4.5★",
			Timestamp: time.Now().Add(-4 * time.Hour),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "app_002",
			Type:      model.FeedItemTypeRecommendation,
			Title:     "Task Manager",
			Subtitle:  "Organize your daily tasks - 4.8★",
			Timestamp: time.Now().Add(-5 * time.Hour),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "plugin_001",
			Type:      model.FeedItemTypePluginContent,
			Title:     "AI Programming Assistant",
			Subtitle:  "New features for developers",
			Timestamp: time.Now().Add(-6 * time.Hour),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "recommend_001",
			Type:      model.FeedItemTypeRecommendation,
			Title:     "Welcome to Peers-Touch",
			Subtitle:  "Get started with your decentralized social network",
			Timestamp: time.Now().Add(-24 * time.Hour),
			Source:    model.ContentSourceStationFeed,
		},
	}

	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}

	return &model.FeedResponse{
		Items: items,
	}, nil
}
