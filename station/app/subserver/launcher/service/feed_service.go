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
			ID:        "feed_1",
			Type:      model.FeedItemTypeRecommendation,
			Title:     "Welcome to Peers-Touch",
			Subtitle:  "Get started with your decentralized social network",
			Timestamp: time.Now(),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "feed_2",
			Type:      model.FeedItemTypePluginContent,
			Title:     "AI Programming Assistant Released",
			Subtitle:  "New features for developers",
			Timestamp: time.Now().Add(-2 * time.Hour),
			Source:    model.ContentSourceStationFeed,
		},
		{
			ID:        "feed_3",
			Type:      model.FeedItemTypeRecentActivity,
			Title:     "Your friend Alice posted a new update",
			Subtitle:  "Check out what's new in the community",
			Timestamp: time.Now().Add(-5 * time.Hour),
			Source:    model.ContentSourceFederation,
		},
	}

	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}

	return &model.FeedResponse{
		Items: items,
	}, nil
}
