package persistence

import "time"

// ProjectState stores Station-owned project and root milestone state snapshots.
type ProjectState struct {
	ProjectID      string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_agent_project_states_task"`
	ProjectState   string    `gorm:"type:varchar(32);index:idx_agent_project_states_project_state"`
	MilestoneState string    `gorm:"type:varchar(32);index:idx_agent_project_states_milestone_state"`
	SourceEventID  string    `gorm:"type:varchar(36);index:idx_agent_project_states_event"`
	SourceEventSeq int64     `gorm:"not null;default:0;index:idx_agent_project_states_event_seq"`
	PayloadJSON    string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime;index:idx_agent_project_states_created"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_project_states_updated"`
}

func (ProjectState) TableName() string { return "agent_project_states" }
