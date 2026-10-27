package accessgate

import (
	"errors"
	"time"

	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RetireLinkedAttemptInTransaction removes only the expired, uncommitted
// Access scope supplied by its offer owner. A committed Session retains its
// Access audit. Invite consumption and other business truth are not rewound.
func RetireLinkedAttemptInTransaction(tx *gorm.DB, id string, before time.Time) error {
	if tx == nil || tx.Statement == nil {
		return errors.New("Access retirement requires a transaction")
	}
	if _, ok := tx.Statement.ConnPool.(gorm.TxCommitter); !ok {
		return errors.New("Access retirement requires an active transaction")
	}
	var attempt db.AccessAttempt
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&attempt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if attempt.SessionID != "" {
		return nil
	}
	if (attempt.AuthMethod != "" && attempt.AuthMethod != "device_link") ||
		(attempt.Status != attemptStatusCancelled && attempt.Status != attemptStatusExpired) ||
		!attempt.ExpiresAt.Before(before) {
		return errors.New("Access retirement scope is not expired and uncommitted")
	}
	if err := tx.Where("attempt_id = ?", id).Delete(&db.AccessGateSubmission{}).Error; err != nil {
		return err
	}
	return tx.Where("id = ? AND session_id = ?", id, "").Delete(&db.AccessAttempt{}).Error
}
