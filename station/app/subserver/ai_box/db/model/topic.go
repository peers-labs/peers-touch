package model

import (
	"time"
)

// Topic 主题表
type Topic struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	SessionID      string    `gorm:"not null;type:varchar(36);index:idx_topics_session_id,priority:1"`
	Title          string    `gorm:"not null;type:varchar(255)"`
	Description    *string   `gorm:"type:text"`
	MessageCount   *int      `gorm:"default:0;type:integer"`
	FirstMessageID *string   `gorm:"type:varchar(36)"`
	LastMessageID  *string   `gorm:"type:varchar(36)"`
	CreatedAt      time.Time `gorm:"not null;default:now();index:idx_topics_created_at,priority:1"`
	UpdatedAt      time.Time `gorm:"not null;default:now()"`

	// 关联关系
	Session      Session   `gorm:"foreignKey:SessionID;references:ID"`
	FirstMessage *Message  `gorm:"foreignKey:FirstMessageID;references:ID"`
	LastMessage  *Message  `gorm:"foreignKey:LastMessageID;references:ID"`
	Messages     []Message `gorm:"foreignKey:TopicID;references:ID"`
}

// TableName 设置表名
func (Topic) TableName() string {
	return "ai_box.topics"
}
