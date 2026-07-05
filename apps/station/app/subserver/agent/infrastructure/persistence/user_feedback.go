package persistence

import "time"

// UserFeedback records explicit user feedback signals on agent responses.
type UserFeedback struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID        string    `gorm:"not null;type:varchar(36);index:idx_feedback_agent_id"`
	TurnID         string    `gorm:"not null;type:varchar(36);index:idx_feedback_turn_id"`
	ConversationID string    `gorm:"not null;type:varchar(36)"`
	Signal         string    `gorm:"not null;type:varchar(10);check:signal in ('positive','negative')"` // positive=thumbs up, negative=thumbs down
	Comment        *string   `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime"`
}

func (UserFeedback) TableName() string { return "agent_user_feedback" }
