package activitypub

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// UpdateActorStatus updates the online status and heartbeat of an actor
func UpdateActorStatus(ctx context.Context, actorID uint64, status int, clientInfo string) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	actorStatus := db.ActorStatus{
		ActorID:       actorID,
		Status:        status,
		LastHeartbeat: time.Now(),
		ClientInfo:    clientInfo,
	}

	// Use Save to update all fields including zero values if needed,
	// or create if not exists.
	// Since ActorID is primary key, Save will perform UPSERT.
	return rds.WithContext(ctx).Save(&actorStatus).Error
}

// GetOnlineActors returns a list of online actors excluding the requester
// Filters by Status=Online and actorType='Person' (default user type)
func GetOnlineActors(ctx context.Context, currentActorID uint64) ([]*model.OnlineActor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}

	// Use an anonymous struct for scanning query results
	var results []struct {
		ActorID           uint64    `json:"id"`
		Name              string    `json:"name"`
		PreferredUsername string    `json:"preferred_username"`
		AvatarUrl         string    `json:"avatar_url"`
		Status            int       `json:"status"`
		LastHeartbeat     time.Time `json:"last_heartbeat"`
	}

	// Define timeout threshold (e.g., 5 minutes without heartbeat = offline)
	heartbeatThreshold := time.Now().Add(-5 * time.Minute)

	err = rds.WithContext(ctx).
		Table("touch_actor_status").
		Select("touch_actor_status.actor_id, touch_actor.name, touch_actor.preferred_username, touch_actor.icon as avatar_url, touch_actor_status.status, touch_actor_status.last_heartbeat").
		Joins("JOIN touch_actor ON touch_actor.id = touch_actor_status.actor_id").
		Where("touch_actor_status.actor_id != ?", currentActorID).
		Where("touch_actor_status.status = ?", db.ActorStatusOnline).
		Where("touch_actor_status.last_heartbeat > ?", heartbeatThreshold).
		Where("touch_actor.type = ?", "Person").
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	// Map results to proto model
	onlineActors := make([]*model.OnlineActor, 0, len(results))
	for _, r := range results {
		onlineActors = append(onlineActors, &model.OnlineActor{
			Id:                r.ActorID,
			Name:              r.Name,
			PreferredUsername: r.PreferredUsername,
			AvatarUrl:         r.AvatarUrl,
			Status:            int32(r.Status),
			LastHeartbeat:     r.LastHeartbeat.Format(time.RFC3339),
		})
	}

	return onlineActors, nil
}
