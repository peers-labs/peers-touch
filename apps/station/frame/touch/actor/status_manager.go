package actor

import (
	"context"
	"sync"
	"time"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

type StatusManager struct {
	OfflineThreshold time.Duration
	AwayThreshold    time.Duration
}

var GlobalStatusManager *StatusManager
var initOnce sync.Once

func InitStatusManager(ctx context.Context) {
	initOnce.Do(func() {
		GlobalStatusManager = &StatusManager{
			OfflineThreshold: 5 * time.Minute,
			AwayThreshold:    2 * time.Minute,
		}
		go GlobalStatusManager.StartWatchDog(ctx)
	})
}

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

func (m *StatusManager) ScanTimeouts(ctx context.Context) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Errorf(ctx, "StatusManager: Failed to get DB connection: %v", err)
		return
	}

	now := time.Now()
	offlineCutoff := now.Add(-m.OfflineThreshold)

	result := rds.WithContext(ctx).
		Model(&db.ActorStatus{}).
		Where("status != ? AND last_heartbeat < ?", db.ActorStatusOffline, offlineCutoff).
		Update("status", db.ActorStatusOffline)

	if result.Error != nil {
		log.Errorf(ctx, "StatusManager: Failed to update offline status: %v", result.Error)
	} else if result.RowsAffected > 0 {
		log.Infof(ctx, "StatusManager: Marked %d actors as offline", result.RowsAffected)
	}
}

func (m *StatusManager) KeepAlive(ctx context.Context, actorID uint64, clientInfo string) error {
	return UpdateActorStatus(ctx, actorID, db.ActorStatusOnline, clientInfo)
}
