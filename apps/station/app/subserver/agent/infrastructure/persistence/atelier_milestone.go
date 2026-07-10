package persistence

import "time"

// AtelierMilestone stores Station-owned MilestoneTree query records for Atelier projection.
type AtelierMilestone struct {
	MilestoneID                string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID                     string    `gorm:"not null;type:varchar(36);index:idx_agent_atelier_milestones_task"`
	ParentID                   string    `gorm:"type:varchar(64);index:idx_agent_atelier_milestones_parent"`
	Title                      string    `gorm:"type:text"`
	State                      string    `gorm:"type:varchar(32);index:idx_agent_atelier_milestones_state"`
	TaskIDsJSON                string    `gorm:"type:text"`
	AcceptancePredicateIDsJSON string    `gorm:"type:text"`
	DependsOnJSON              string    `gorm:"type:text"`
	SourceEventID              string    `gorm:"type:varchar(36);index:idx_agent_atelier_milestones_event"`
	SourceEventSeq             int64     `gorm:"not null;default:0;index:idx_agent_atelier_milestones_event_seq"`
	PayloadJSON                string    `gorm:"type:text"`
	CreatedAt                  time.Time `gorm:"not null;default:now();index:idx_agent_atelier_milestones_created"`
	UpdatedAt                  time.Time `gorm:"not null;default:now();index:idx_agent_atelier_milestones_updated"`
}

func (AtelierMilestone) TableName() string { return "agent_atelier_milestones" }
