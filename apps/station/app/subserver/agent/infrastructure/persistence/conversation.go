package persistence

import (
	"encoding/json"
	"time"
)

// Conversation maps to the agent_conversations table.
type Conversation struct {
	ID                    string          `gorm:"primaryKey;type:varchar(36)"`
	AgentID               string          `gorm:"type:varchar(36);index:idx_conversations_agent_id"`
	Ptid                  string          `gorm:"not null;type:text;index:idx_conversations_ptid"`
	Title                 string          `gorm:"not null;type:varchar(255)"`
	Description           *string         `gorm:"type:text"`
	ProviderID            string          `gorm:"not null;type:varchar(64);index"`
	ModelName             *string         `gorm:"type:varchar(100)"`
	Status                string          `gorm:"not null;type:varchar(20);default:'active';index:idx_conversations_status"`
	ParentID              *string         `gorm:"type:varchar(36);index:idx_conversations_parent_id"`
	ConfigJSON            json.RawMessage `gorm:"type:jsonb;column:config_json"`
	Meta                  json.RawMessage `gorm:"type:jsonb"`
	ActiveBranchMessageID string          `gorm:"not null;type:varchar(36);default:''"`
	QueuedTurnCount       uint32          `gorm:"not null;default:0"`
	Version               uint64          `gorm:"not null;default:1"`
	CreatedAt             time.Time       `gorm:"not null;autoCreateTime;index:idx_conversations_created_at"`
	UpdatedAt             time.Time       `gorm:"not null;autoUpdateTime"`

	// Relations
	Messages []AgentMessage `gorm:"foreignKey:ConversationID;references:ID"`
}

// TableName sets the table name.
func (Conversation) TableName() string { return "agent_conversations" }
