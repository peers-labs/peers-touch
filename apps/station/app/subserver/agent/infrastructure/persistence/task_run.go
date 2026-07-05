package persistence

import "time"

// TaskRun is the Station-owned lifecycle owner for an agent task.
// A Chat conversation maps to exactly one TaskRun with surface=CHAT; the
// ConversationID column carries the find-or-create key so a conversation can
// only ever own a single root task.
type TaskRun struct {
	TaskID              string     `gorm:"primaryKey;type:varchar(36)"`
	Title               string     `gorm:"type:text"`
	Description         string     `gorm:"type:text"`
	Surface             int32      `gorm:"not null;type:integer;index:idx_agent_task_runs_surface"`
	Status              int32      `gorm:"not null;type:integer;index:idx_agent_task_runs_status"`
	OwnerActorID        string     `gorm:"not null;type:varchar(64);index:idx_agent_task_runs_owner"`
	WorkspaceID         string     `gorm:"type:varchar(64)"`
	ConversationID      string     `gorm:"type:varchar(36);uniqueIndex:idx_agent_task_runs_conversation"`
	RootTurnID          string     `gorm:"type:varchar(36)"`
	CurrentCheckpointID string     `gorm:"type:varchar(36)"`
	MetaJSON            string     `gorm:"type:text"`
	CreatedAt           time.Time  `gorm:"not null;autoCreateTime"`
	StartedAt           time.Time  `gorm:"not null;autoCreateTime"`
	UpdatedAt           time.Time  `gorm:"not null;autoUpdateTime"`
	EndedAt             *time.Time `gorm:"type:timestamptz"`
}

func (TaskRun) TableName() string { return "agent_task_runs" }
