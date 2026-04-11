package persistence

import (
	"encoding/json"
	"time"
)

// AgentMessage maps to the agent_messages table.
type AgentMessage struct {
	ID             string          `gorm:"primaryKey;type:varchar(36)"`
	ConversationID string          `gorm:"not null;type:varchar(36);index:idx_agent_messages_conversation_id"`
	TurnID         *string         `gorm:"type:varchar(36);index:idx_agent_messages_turn_id"`
	ModelName      *string         `gorm:"type:varchar(100)"`
	Role           string          `gorm:"not null;type:varchar(20);check:role in ('system','user','assistant','tool')"`
	Content        *string         `gorm:"type:text"`
	ReasoningJSON  json.RawMessage `gorm:"type:jsonb;column:reasoning_json"`
	ToolCallsJSON  json.RawMessage `gorm:"type:jsonb;column:tool_calls_json"`
	MetadataJSON   json.RawMessage `gorm:"type:jsonb;column:metadata_json"`
	ErrorJSON      json.RawMessage `gorm:"type:jsonb;column:error_json"`
	CreatedAt      time.Time       `gorm:"not null;default:now();index:idx_agent_messages_created_at"`
	UpdatedAt      time.Time       `gorm:"not null;default:now()"`

	// Relations
	Conversation Conversation `gorm:"foreignKey:ConversationID;references:ID"`
}

// TableName sets the table name.
func (AgentMessage) TableName() string { return "agent_messages" }
