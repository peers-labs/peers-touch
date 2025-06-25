package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"time"

	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"gorm.io/gorm"
)

func (s *SubServer) autoMigrate(ctx context.Context) error {
	rds, err := s.store.RDS(ctx)
	if err != nil {
		log.Warnf(ctx, "[GetUserByName] Get db err: %v", err)
		return err
	}

	return rds.AutoMigrate(&PeerInfo{}, &ConnectionInfo{})
}

// savePeerInfo saves both PeerInfo and ConnectionInfo, checking for existing records first
// - Updates existing PeerInfo if needed
// - Creates or updates ConnectionInfo based on peerId + direction uniqueness
func (s *SubServer) savePeerInfo(ctx context.Context, pi PeerInfo, conn ConnectionInfo) (err error) {
	db, err := s.store.RDS(ctx)

	// ------------------------------
	// 1. listPeers PeerInfo (upsert)
	// ------------------------------
	var existingPeer PeerInfo
	err = db.WithContext(ctx).Where("peer_id = ?", pi.PeerID).First(&existingPeer).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		// Set default values for new peer
		pi.FirstSeenAt = time.Now()
		pi.LastSeenAt = time.Now() // First connection = last seen
		if err = db.WithContext(ctx).Create(&pi).Error; err != nil {
			return err
		}
	case err != nil:
		// Database query error
		return err
	default:
		// Update existing peer with new data
		existingPeer.LastSeenAt = time.Now() // Update last seen time
		if err = db.WithContext(ctx).Save(&existingPeer).Error; err != nil {
			return err
		}
	}

	// ------------------------------
	// 2. Delete old ConnectionInfo records for this peer
	// ------------------------------
	err = db.WithContext(ctx).
		Where("peer_id = ?", conn.PeerID).
		Delete(&ConnectionInfo{}).Error
	if err != nil {
		return fmt.Errorf("[savePeerInfo] Failed to delete old records, err: %s", err) // Failed to delete old records
	}

	// ------------------------------
	// 3. Save the latest ConnectionInfo
	// ------------------------------
	if err = db.WithContext(ctx).Create(&conn).Error; err != nil {
		return err // Failed to save new record
	}

	return nil
}
