package persistence

import "time"

// DiagnosticReport stores growth diagnostic analysis results generated
// when GrowthScore enters the "declining" state. Contains suspected items
// and recommended actions for user review.
type DiagnosticReport struct {
	ID            string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID       string    `gorm:"not null;type:varchar(36);index:idx_diagnostic_agent_id"`
	GrowthScore   float64   `gorm:"not null"`
	GrowthVerdict string    `gorm:"not null;type:varchar(20)"`
	SuspectedJSON string    `gorm:"type:text"` // JSON: [{item_type, item_id, item_content, negative_count, recommended_action}]
	Summary       string    `gorm:"type:text"`
	CreatedAt     time.Time `gorm:"not null;autoCreateTime;index:idx_diagnostic_created_at"`
}

func (DiagnosticReport) TableName() string { return "agent_diagnostic_reports" }
