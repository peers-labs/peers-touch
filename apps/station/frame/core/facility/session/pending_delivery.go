package session

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ActivatePendingDeviceSession activates the exact inactive credential row
// after its owning transaction has validated receiver acknowledgement.
func ActivatePendingDeviceSession(tx *gorm.DB, expected *SessionRecord, now time.Time) error {
	if tx == nil || tx.Statement == nil || expected == nil {
		return errors.New("pending session activation requires a transaction and binding")
	}
	if _, ok := tx.Statement.ConnPool.(gorm.TxCommitter); !ok {
		return errors.New("pending session activation requires an active transaction")
	}
	var current SessionRecord
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("session_id = ?", expected.SessionID).First(&current).Error; err != nil {
		return err
	}
	if !current.Revoked || current.RevokedReason != "credential_delivery_pending" ||
		current.UserID != expected.UserID || current.DeviceID != expected.DeviceID ||
		current.DeviceType != expected.DeviceType ||
		current.StationPeerID != expected.StationPeerID || current.AccessAttemptID != expected.AccessAttemptID ||
		current.AccessDecisionRevision != expected.AccessDecisionRevision || current.AuthMethod != expected.AuthMethod ||
		current.LifecycleGeneration != expected.LifecycleGeneration || !current.ExpiresAt.After(now) {
		return errors.New("pending session activation binding changed")
	}
	if _, err := RevokeReplacedDeviceSessions(tx, current.UserID, current.DeviceBinding(), current.SessionID, now); err != nil {
		return err
	}
	result := tx.Model(&SessionRecord{}).Where("session_id = ? AND revoked = ? AND revoked_reason = ?",
		current.SessionID, true, "credential_delivery_pending").
		Updates(map[string]any{"revoked": false, "revoked_at": nil, "revoked_reason": "", "last_active_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("pending session activation lost its fence")
	}
	return nil
}

func DeletePendingDeviceSession(tx *gorm.DB, sessionID, accessAttemptID string) error {
	return tx.Where("session_id = ? AND access_attempt_id = ? AND revoked = ? AND revoked_reason = ?",
		sessionID, accessAttemptID, true, "credential_delivery_pending").Delete(&SessionRecord{}).Error
}
