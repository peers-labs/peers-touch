package accessgate

import (
	"errors"
	"time"

	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// CommitLinkedSessionInTransaction binds exactly one acknowledged credential
// to a currently granted attempt. Other login finalizers cannot consume it.
func CommitLinkedSessionInTransaction(tx *gorm.DB, id, sessionID string, revision uint64, now time.Time) error {
	row, err := linkedAttemptRow(tx, id, now)
	if err != nil {
		return err
	}
	if row.AuthMethod != "device_link" || row.Status != attemptStatusGranted || row.DecisionRevision != revision ||
		row.SessionID != "" || sessionID == "" {
		return errors.New("linked Access session binding changed")
	}
	result := tx.Model(&db.AccessAttempt{}).Where("id = ? AND decision_revision = ? AND session_id = ?",
		id, revision, "").Update("session_id", sessionID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("linked Access session commit lost its fence")
	}
	return nil
}
