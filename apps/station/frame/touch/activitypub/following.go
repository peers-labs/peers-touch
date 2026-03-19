package activitypub

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func FetchFollowing(c context.Context, username string, baseURL string, page bool) (interface{}, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		logger.Errorf(c, "Failed to get database connection: %v", err)
		return nil, fmt.Errorf("database connection failed: %w", err)
	}

	var actor db.Actor
	if err := rds.Where("preferred_username = ?", username).First(&actor).Error; err != nil {
		logger.Warnf(c, "Actor not found: %s", username)
		return nil, fmt.Errorf("actor not found: %s", username)
	}

	var follows []db.Follow
	if err := rds.Where("follower_id = ?", actor.ID).
		Find(&follows).Error; err != nil {
		logger.Errorf(c, "Failed to query follows: %v", err)
		return nil, fmt.Errorf("query follows failed: %w", err)
	}

	items := make([]map[string]interface{}, 0, len(follows))
	for _, follow := range follows {
		var targetActor db.Actor
		if err := rds.Where("id = ?", follow.FollowingID).First(&targetActor).Error; err != nil {
			continue
		}

		item := map[string]interface{}{
			"id":                fmt.Sprintf("%s/activitypub/%s/actor", baseURL, targetActor.PreferredUsername),
			"type":              "Person",
			"preferredUsername": targetActor.PreferredUsername,
			"name":              targetActor.Name,
			"inbox":             fmt.Sprintf("%s/activitypub/%s/inbox", baseURL, targetActor.PreferredUsername),
			"outbox":            fmt.Sprintf("%s/activitypub/%s/outbox", baseURL, targetActor.PreferredUsername),
		}

		if targetActor.Icon != "" {
			item["icon"] = map[string]interface{}{
				"type": "Image",
				"url":  targetActor.Icon,
			}
		}

		items = append(items, item)
	}

	collection := map[string]interface{}{
		"@context":     "https://www.w3.org/ns/activitystreams",
		"id":           fmt.Sprintf("%s/activitypub/%s/following", baseURL, username),
		"type":         "OrderedCollection",
		"totalItems":   len(items),
		"orderedItems": items,
	}

	return collection, nil
}
