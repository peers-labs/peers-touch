package persistence

import (
	"encoding/json"
	"time"
)

// AgentMessage maps to the agent_messages table.
type AgentMessage struct {
	ID                string          `gorm:"primaryKey;type:varchar(36)"`
	ConversationID    string          `gorm:"not null;type:varchar(36);index:idx_agent_messages_conversation_id;index:idx_agent_messages_conv_seq,priority:1"`
	TurnID            *string         `gorm:"type:varchar(36);index:idx_agent_messages_turn_id"`
	ModelName         *string         `gorm:"type:varchar(100)"`
	Role              string          `gorm:"not null;type:varchar(20);check:role in ('system','user','assistant','tool')"`
	Status            string          `gorm:"not null;type:varchar(20);default:'completed'"`
	Content           *string         `gorm:"type:text"`
	ReasoningJSON     json.RawMessage `gorm:"type:jsonb;column:reasoning_json"`
	ToolCallsJSON     json.RawMessage `gorm:"type:jsonb;column:tool_calls_json"`
	MetadataJSON      json.RawMessage `gorm:"type:jsonb;column:metadata_json"`
	ErrorJSON         json.RawMessage `gorm:"type:jsonb;column:error_json"`
	AttachmentsJSON   json.RawMessage `gorm:"type:jsonb;column:attachments_json"`
	Seq               int64           `gorm:"not null;uniqueIndex:idx_agent_messages_conv_seq,priority:2"`
	BranchID          *string         `gorm:"type:varchar(36);index:idx_agent_messages_branch"`
	ReplacesMessageID *string         `gorm:"type:varchar(36)"`
	ParentMessageID   *string         `gorm:"type:varchar(36);index:idx_agent_messages_parent"`
	ThreadID          *string         `gorm:"type:varchar(36);index:idx_agent_messages_thread"`
	TombstonedAt      *time.Time      `gorm:"type:timestamp;index:idx_agent_messages_tombstoned"`
	TombstonedByPtid  *string         `gorm:"type:text"`
	TombstoneReason   *string         `gorm:"type:text"`
	CreatedAt         time.Time       `gorm:"not null;autoCreateTime;index:idx_agent_messages_created_at"`
	UpdatedAt         time.Time       `gorm:"not null;autoUpdateTime"`

	Conversation Conversation `gorm:"foreignKey:ConversationID;references:ID"`
}

// TableName sets the table name.
func (AgentMessage) TableName() string { return "agent_messages" }
