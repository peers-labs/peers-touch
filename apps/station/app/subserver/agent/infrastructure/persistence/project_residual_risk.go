package persistence

import "time"

// ProjectResidualRisk stores Station-owned residual risk lifecycle state.
type ProjectResidualRisk struct {
	RiskID         string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_agent_project_residual_risks_task"`
	Description    string    `gorm:"type:text"`
	State          string    `gorm:"type:varchar(32);index:idx_agent_project_residual_risks_state"`
	EvidenceRef    string    `gorm:"type:text"`
	Owner          string    `gorm:"type:varchar(64);index:idx_agent_project_residual_risks_owner"`
	SourceEventID  string    `gorm:"type:varchar(36);index:idx_agent_project_residual_risks_event"`
	SourceEventSeq int64     `gorm:"not null;default:0;index:idx_agent_project_residual_risks_event_seq"`
	PayloadJSON    string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;default:now();index:idx_agent_project_residual_risks_created"`
	UpdatedAt      time.Time `gorm:"not null;default:now();index:idx_agent_project_residual_risks_updated"`
}

func (ProjectResidualRisk) TableName() string { return "agent_project_residual_risks" }
