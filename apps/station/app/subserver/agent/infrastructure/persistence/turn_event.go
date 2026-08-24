package persistence

import "time"

type TurnEvent struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	ConversationID string    `gorm:"not null;type:varchar(36);index:idx_turn_events_conv"`
	TurnID         string    `gorm:"not null;type:varchar(36);uniqueIndex:idx_turn_events_turn_seq,priority:1;index:idx_turn_events_turn"`
	EventSeq       int64     `gorm:"not null;uniqueIndex:idx_turn_events_turn_seq,priority:2"`
	EventType      string    `gorm:"not null;type:varchar(40);index:idx_turn_events_type"`
	Payload        string    `gorm:"type:text;not null"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime;index:idx_turn_events_created"`
}

func (TurnEvent) TableName() string { return "agent_turn_events" }
