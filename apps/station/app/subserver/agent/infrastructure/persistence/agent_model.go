package persistence

import (
	"encoding/json"
	"time"
)

// AgentModel maps to the agent_models table.
// Stores per-actor model configuration within a provider.
type AgentModel struct {
	ID               string          `gorm:"primaryKey;type:varchar(36)"`
	ActorID          string          `gorm:"not null;type:varchar(36);default:'';uniqueIndex:idx_agent_models_actor_provider_model"`
	ProviderID       string          `gorm:"not null;type:varchar(64);uniqueIndex:idx_agent_models_actor_provider_model"`
	ModelID          string          `gorm:"not null;type:varchar(128);uniqueIndex:idx_agent_models_actor_provider_model"`
	DisplayName      string          `gorm:"type:varchar(256)"`
	Enabled          bool            `gorm:"not null;default:true"`
	CapabilitiesJSON json.RawMessage `gorm:"type:jsonb"`
	ContextWindow    int             `gorm:"type:integer"`
	Version          int64           `gorm:"not null;default:1"`
	CreatedAt        time.Time       `gorm:"not null;autoCreateTime"`
	UpdatedAt        time.Time       `gorm:"not null;autoUpdateTime"`
}

// TableName sets the table name.
func (AgentModel) TableName() string { return "agent_models" }
