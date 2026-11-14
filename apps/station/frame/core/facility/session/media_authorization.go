package session

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/mediaaccess"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MediaSession struct {
	SessionID string
	DeviceID  string
	ExpiresAt time.Time
}

// WithMediaSessionFence resolves identity through Session's persisted binding.
// Activation's actor lock and the session row remain held through callback.
// The callback must acquire Actor Device before creating a Home media grant.
func (s *DBStore) WithMediaSessionFence(
	ctx context.Context, sessionID, actorPTID, home string,
	issue func(*gorm.DB, MediaSession) error,
) error {
	if sessionID == "" || actorPTID == "" || home == "" || issue == nil {
		return ErrInvalidDeviceBinding
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owner struct{ ID uint64 }
		if err := tx.Table(actorTableName).Select("id").Where("ptid = ?", actorPTID).
			Take(&owner).Error; err != nil {
			return err
		}
		if err := lockActorForSessionActivation(tx, owner.ID); err != nil {
			return err
		}
		var record SessionRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("session_id = ? AND user_id = ? AND station_peer_id = ?",
				sessionID, owner.ID, home).Take(&record).Error; err != nil {
			return err
		}
		if record.Revoked || !record.ExpiresAt.After(time.Now()) ||
			record.DeviceBinding().Validate() != nil {
			return ErrSessionRevoked
		}
		return issue(tx, MediaSession{record.SessionID, record.DeviceID, record.ExpiresAt})
	})
}

// MediaSessionActive is a non-locking owner read for an Authority admission.
// Home's grant tombstone serializes admission with revoke; reading must not
// invert the device/session -> grant lock order during a federated eject.
func (s *DBStore) MediaSessionActive(ctx context.Context, sessionID, actorPTID, deviceID, home string) (bool, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return false, err
	}
	var count int64
	err = db.WithContext(ctx).Model(&SessionRecord{}).
		Joins("JOIN touch_actor ON touch_actor.id = actor_sessions.user_id").
		Where("actor_sessions.session_id = ? AND touch_actor.ptid = ? AND "+
			"actor_sessions.device_id = ? AND actor_sessions.station_peer_id = ? AND "+
			"actor_sessions.revoked = false AND actor_sessions.expires_at > ?",
			sessionID, actorPTID, deviceID, home, time.Now().UTC()).Count(&count).Error
	return count == 1, err
}

// revokeMediaForSessions is invoked before every Session permission reduction,
// including delete, expiry cleanup, replacement and account/device logout.
func revokeMediaForSessions(query *gorm.DB) error {
	var rows []SessionRecord
	if err := query.Session(&gorm.Session{}).Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("session_id").Find(&rows).Error; err != nil {
		return err
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.SessionID)
	}
	if err := mediaaccess.RevokeSessions(query.Statement.Context, ids); err != nil {
		return fmt.Errorf("session media ejection was not confirmed: %w", err)
	}
	return nil
}
