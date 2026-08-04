package persistence

import "time"

// TaskArtifact stores durable artifact evidence produced by orchestration.
type TaskArtifact struct {
	ArtifactID  string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID      string    `gorm:"not null;type:varchar(36);index:idx_agent_task_artifacts_task"`
	StepID      string    `gorm:"type:varchar(36);index:idx_agent_task_artifacts_step"`
	TurnID      string    `gorm:"type:varchar(36);index:idx_agent_task_artifacts_turn"`
	EventID     string    `gorm:"type:varchar(36);index:idx_agent_task_artifacts_event"`
	EventSeq    int64     `gorm:"not null;default:0;index:idx_agent_task_artifacts_event_seq"`
	RunID       string    `gorm:"type:varchar(64);index:idx_agent_task_artifacts_run"`
	Kind        string    `gorm:"type:varchar(64);index:idx_agent_task_artifacts_kind"`
	Name        string    `gorm:"type:text"`
	URI         string    `gorm:"type:text"`
	Checksum    string    `gorm:"type:text"`
	ProducedBy  string    `gorm:"type:varchar(128);index:idx_agent_task_artifacts_produced_by"`
	RefsJSON    string    `gorm:"type:text"`
	PayloadJSON string    `gorm:"type:text"`
	CreatedAt   time.Time `gorm:"not null;autoCreateTime;index:idx_agent_task_artifacts_created"`
}

func (TaskArtifact) TableName() string { return "agent_task_artifacts" }
