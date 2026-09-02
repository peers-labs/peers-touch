package persistence

import (
	"encoding/json"
	"time"
)

// UserFeedback records explicit user feedback signals on agent responses.
type UserFeedback struct {
	ID                 string          `gorm:"primaryKey;type:varchar(36)"`
	Ptid               string          `gorm:"not null;type:text;default:'';index:idx_feedback_ptid_turn,priority:1"`
	AgentID            string          `gorm:"not null;type:varchar(36);index:idx_feedback_agent_id"`
	TurnID             string          `gorm:"not null;type:varchar(36);index:idx_feedback_turn_id;index:idx_feedback_ptid_turn,priority:2"`
	ConversationID     string          `gorm:"not null;type:varchar(36)"`
	AssistantMessageID string          `gorm:"not null;type:varchar(36);default:''"`
	Source             string          `gorm:"not null;type:varchar(32);default:'user'"`
	Signal             string          `gorm:"not null;type:varchar(10);check:signal in ('positive','negative')"`
	Rating             int32           `gorm:"not null;default:0"`
	Categories         json.RawMessage `gorm:"type:jsonb"`
	Comment            *string         `gorm:"type:text"`
	IdempotencyKey     string          `gorm:"not null;type:varchar(100);default:'';index"`
	CreatedAt          time.Time       `gorm:"not null;autoCreateTime"`
	UpdatedAt          time.Time       `gorm:"not null;autoUpdateTime"`
}

func (UserFeedback) TableName() string { return "agent_user_feedback" }
