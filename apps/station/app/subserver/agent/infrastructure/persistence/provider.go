// Changelog:
// 2026-04-11 — Initial creation: AgentProvider persistence model for the
//   agent_providers table. Stores LLM provider configuration (base_url,
//   api_key, model) independently from the legacy ai_chat domain.

package persistence

import (
	"encoding/json"
	"time"
)

// AgentProvider maps to the agent_providers table.
// This is the agent domain's own provider configuration store, replacing
// the legacy cross-domain dependency on the ai_chat_providers table.
type AgentProvider struct {
	ID         string          `gorm:"primaryKey;type:varchar(36)"`
	Name       string          `gorm:"not null;type:text"`
	KeyVaults  string          `gorm:"type:text"`
	Config     json.RawMessage `gorm:"type:jsonb"`
	SourceType string          `gorm:"type:varchar(20)"`
	CheckModel string          `gorm:"type:text"`
	Enabled    bool            `gorm:"not null;default:true"`
	CreatedAt  time.Time       `gorm:"not null;default:now()"`
	UpdatedAt  time.Time       `gorm:"not null;default:now()"`
}

// TableName sets the table name.
func (AgentProvider) TableName() string { return "agent_providers" }
