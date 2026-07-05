package persistence

import "time"

// GrowthEvent records every growth-related action for audit and metrics.
type GrowthEvent struct {
	ID        string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID   string    `gorm:"not null;type:varchar(36);index:idx_growth_events_agent_id"`
	EventType string    `gorm:"not null;type:varchar(30);index:idx_growth_events_type"`
	Category  string    `gorm:"not null;type:varchar(20)"` // memory, skill, review, feedback
	Target    string    `gorm:"type:varchar(128)"`         // e.g. memory_id, skill_name, turn_id
	Details   string    `gorm:"type:text"`                 // JSON payload
	Outcome   string    `gorm:"type:varchar(20)"`          // success, failure, skipped
	CreatedAt time.Time `gorm:"not null;autoCreateTime;index:idx_growth_events_created_at"`
}

func (GrowthEvent) TableName() string { return "agent_growth_events" }
