package activitypub

import (
	"context"
	"sync"
	"time"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// StatusManager handles actor status updates and monitoring
type StatusManager struct {
	// Configuration for timeouts
	OfflineThreshold time.Duration
	AwayThreshold    time.Duration
}

// GlobalStatusManager is the singleton instance
var GlobalStatusManager *StatusManager
var initOnce sync.Once

// InitStatusManager initializes the global status manager and starts watchdog.
func InitStatusManager(ctx context.Context) {
	initOnce.Do(func() {
		GlobalStatusManager = &StatusManager{
			OfflineThreshold: 5 * time.Minute,
			AwayThreshold:    2 * time.Minute,
		}
		go GlobalStatusManager.StartWatchDog(ctx)
	})
}

// StartWatchDog starts the background routine to clean up stale sessions
func (m *StatusManager) StartWatchDog(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.ScanTimeouts(ctx)
		}
	}
}

// ScanTimeouts checks for actors who haven't sent heartbeats recently
func (m *StatusManager) ScanTimeouts(ctx context.Context) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Errorf(ctx, "StatusManager: Failed to get DB connection: %v", err)
		return
	}

	now := time.Now()
	offlineCutoff := now.Add(-m.OfflineThreshold)
	// awayCutoff := now.Add(-m.AwayThreshold)

	// 1. Mark stale users as Offline
	// UPDATE touch_actor_status SET status = 0 WHERE status != 0 AND last_heartbeat < offlineCutoff
	result := rds.WithContext(ctx).
		Model(&db.ActorStatus{}).
		Where("status != ? AND last_heartbeat < ?", db.ActorStatusOffline, offlineCutoff).
		Update("status", db.ActorStatusOffline)

	if result.Error != nil {
		log.Errorf(ctx, "StatusManager: Failed to update offline status: %v", result.Error)
	} else if result.RowsAffected > 0 {
		log.Infof(ctx, "StatusManager: Marked %d actors as offline", result.RowsAffected)
	}

	// 2. Mark inactive users as Away (Optional, can be enabled later)
	// For now, we focus on Online/Offline binary state to keep it simple as requested
}

// KeepAlive updates the heartbeat for an actor
func (m *StatusManager) KeepAlive(ctx context.Context, actorID uint64, clientInfo string) error {
	// This is just a wrapper around the existing service function logic
	// Ideally, the logic from status_service.go should be moved here
	return UpdateActorStatus(ctx, actorID, db.ActorStatusOnline, clientInfo)
}
