package persistence

import "time"

// ProjectBlocker stores Station-owned project blocker lifecycle state.
type ProjectBlocker struct {
	BlockerID      string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_agent_project_blockers_task"`
	Scope          string    `gorm:"type:varchar(32);index:idx_agent_project_blockers_scope"`
	Owner          string    `gorm:"type:varchar(64);index:idx_agent_project_blockers_owner"`
	Severity       string    `gorm:"type:varchar(32);index:idx_agent_project_blockers_severity"`
	State          string    `gorm:"type:varchar(32);index:idx_agent_project_blockers_state"`
	EvidenceRef    string    `gorm:"type:text"`
	Reason         string    `gorm:"type:text"`
	SourceEventID  string    `gorm:"type:varchar(36);index:idx_agent_project_blockers_event"`
	SourceEventSeq int64     `gorm:"not null;default:0;index:idx_agent_project_blockers_event_seq"`
	PayloadJSON    string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime;index:idx_agent_project_blockers_created"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_project_blockers_updated"`
}

func (ProjectBlocker) TableName() string { return "agent_project_blockers" }
