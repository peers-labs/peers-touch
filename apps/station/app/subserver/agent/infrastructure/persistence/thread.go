package persistence

import (
	"time"
)

// AgentThread maps to the agent_threads table. A thread is a durable
// sub-conversation forked from a source message inside a conversation.
type AgentThread struct {
	ID              string    `gorm:"primaryKey;type:varchar(36)"`
	ConversationID  string    `gorm:"not null;type:varchar(36);index:idx_agent_threads_conversation_id"`
	SourceMessageID string    `gorm:"not null;type:varchar(36);index:idx_agent_threads_source_message_id"`
	Title           string    `gorm:"not null;type:varchar(255);default:''"`
	SourceSeq       int64     `gorm:"not null;default:0"`
	CreatedAt       time.Time `gorm:"not null;autoCreateTime;index:idx_agent_threads_created_at"`
	UpdatedAt       time.Time `gorm:"not null;autoUpdateTime"`

	Conversation Conversation `gorm:"foreignKey:ConversationID;references:ID"`
}

// TableName sets the table name.
func (AgentThread) TableName() string { return "agent_threads" }
