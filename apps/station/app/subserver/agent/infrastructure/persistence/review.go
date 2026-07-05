package persistence

import (
	"encoding/json"
	"time"
)

// Review maps to the agent_reviews table.
type Review struct {
	ID             string          `gorm:"primaryKey;type:varchar(36)"`
	TurnID         string          `gorm:"not null;type:varchar(36);index:idx_reviews_turn_id"`
	ConversationID string          `gorm:"not null;type:varchar(36);index:idx_reviews_conversation_id"`
	AgentID        string          `gorm:"not null;type:varchar(36);index:idx_reviews_agent_id"`
	ReviewType     string          `gorm:"not null;type:varchar(20);check:review_type in ('memory','skill','combined')"`
	ActionsTaken   json.RawMessage `gorm:"type:jsonb;column:actions_taken"`
	SourceItems    json.RawMessage `gorm:"type:jsonb;column:source_items"`
	OutcomeTracked bool            `gorm:"not null;default:false"`
	ErrorReason    *string         `gorm:"type:text"`
	RetryAttempted bool            `gorm:"not null;default:false"`
	CredentialID   *string         `gorm:"type:varchar(36)"`
	TriggeredAt    time.Time       `gorm:"not null;autoCreateTime"`
	CompletedAt    *time.Time      `gorm:"type:timestamp"`
}

// TableName sets the table name.
func (Review) TableName() string { return "agent_reviews" }
