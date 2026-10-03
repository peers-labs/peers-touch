package persistence

import "time"

const (
	ExternalRuntimeResetPrepared      = "reset_prepared"
	ExternalRuntimeResetCleanupFailed = "cleanup_failed"
	ExternalRuntimeResetCommitted     = "committed"
)

// ExternalRuntimeResetCommand is the durable fence for one destructive
// external-runtime reset. Cleanup runs outside the database transaction and
// commits only when the old binding tuple still matches this record.
type ExternalRuntimeResetCommand struct {
	ID                  string    `gorm:"primaryKey;type:varchar(64)"`
	Ptid                string    `gorm:"not null;type:text;uniqueIndex:idx_external_runtime_reset_key,priority:1"`
	ConversationID      string    `gorm:"not null;type:varchar(36);index"`
	IdempotencyKey      string    `gorm:"not null;type:varchar(160);uniqueIndex:idx_external_runtime_reset_key,priority:2"`
	PayloadHash         string    `gorm:"not null;type:varchar(64)"`
	State               string    `gorm:"not null;type:varchar(32);index"`
	ResetFence          string    `gorm:"not null;type:varchar(64);uniqueIndex"`
	OldSessionID        string    `gorm:"not null;type:varchar(256)"`
	OldSessionEpoch     uint64    `gorm:"not null"`
	OldRuntimeHomeRef   string    `gorm:"not null;type:varchar(64)"`
	SafeErrorCode       string    `gorm:"not null;type:varchar(100);default:''"`
	ResponseJSON        string    `gorm:"not null;type:text;default:''"`
	CleanupAttemptCount uint32    `gorm:"not null;default:0"`
	CreatedAt           time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt           time.Time `gorm:"not null;autoUpdateTime"`
}

func (ExternalRuntimeResetCommand) TableName() string {
	return "agent_external_runtime_reset_commands"
}
