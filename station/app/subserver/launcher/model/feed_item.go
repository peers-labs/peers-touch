package model

import "time"

type FeedItemType string

const (
	FeedItemTypeRecommendation   FeedItemType = "recommendation"
	FeedItemTypePluginContent    FeedItemType = "pluginContent"
	FeedItemTypeUserContent      FeedItemType = "userContent"
	FeedItemTypeFederationUpdate FeedItemType = "federationUpdate"
	FeedItemTypeRecentActivity   FeedItemType = "recentActivity"
)

type ContentSource string

const (
	ContentSourceStationFeed      ContentSource = "stationFeed"
	ContentSourceFriends          ContentSource = "friends"
	ContentSourceRecentChats      ContentSource = "recentChats"
	ContentSourceApplets          ContentSource = "applets"
	ContentSourceRecentActivities ContentSource = "recentActivities"
	ContentSourceFederation       ContentSource = "federation"
)

type FeedItem struct {
	ID        string                 `json:"id"`
	Type      FeedItemType           `json:"type"`
	Title     string                 `json:"title"`
	Subtitle  string                 `json:"subtitle,omitempty"`
	ImageURL  string                 `json:"image_url,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
	Source    ContentSource          `json:"source"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

type FeedResponse struct {
	Items []FeedItem `json:"items"`
}
