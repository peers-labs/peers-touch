package persistence

import "time"

// TaskCheckpoint is a recovery anchor written at each completed step boundary.
// EventSeq points at the last outbox event folded into this checkpoint;
// TaskRun.CurrentCheckpointID references the most recent one so recovery can
// decide which progress has already been collapsed.
type TaskCheckpoint struct {
	CheckpointID        string    `gorm:"primaryKey;type:varchar(36)"`
	TaskID              string    `gorm:"not null;type:varchar(36);index:idx_agent_task_checkpoints_task"`
	EventSeq            int64     `gorm:"not null"`
	StateJSON           string    `gorm:"type:text"`
	VersionsJSON        string    `gorm:"type:text"`
	PendingWritesCursor string    `gorm:"type:text"`
	CreatedAt           time.Time `gorm:"not null;default:now();index:idx_agent_task_checkpoints_created"`
}

func (TaskCheckpoint) TableName() string { return "agent_task_checkpoints" }
