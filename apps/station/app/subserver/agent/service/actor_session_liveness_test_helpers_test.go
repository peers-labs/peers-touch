package service

import (
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/gorm"
)

// migrateActorSessionLiveness brings the identity frame's actor_sessions
// table into the in-memory test database. Active capability-lease reads join
// it; the frame owns the production table and its full schema.
func migrateActorSessionLiveness(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&persistence.ActorSessionLiveness{}); err != nil {
		t.Fatalf("migrate actor session liveness: %v", err)
	}
}

// seedLiveActorSession creates the parent actor session required for an
// active client capability lease. Duplicate seeds keep the caller idempotent.
func seedLiveActorSession(t *testing.T, db *gorm.DB, sessionID string, now time.Time) {
	t.Helper()
	if sessionID == "" {
		t.Fatalf("actor session id is required")
	}
	var existing persistence.ActorSessionLiveness
	err := db.Where("session_id = ?", sessionID).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = db.Create(&persistence.ActorSessionLiveness{
			SessionID: sessionID,
			Revoked:   false,
			ExpiresAt: now.Add(30 * 24 * time.Hour),
		}).Error
	}
	if err != nil {
		t.Fatalf("seed live actor session %q: %v", sessionID, err)
	}
}
