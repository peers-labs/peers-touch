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
	ID            string          `gorm:"primaryKey;type:varchar(36)"`
	ActorPTID     string          `gorm:"column:actor_ptid;not null;type:text;default:'';uniqueIndex:idx_agent_providers_actor_ptid_provider"`
	Name          string          `gorm:"not null;type:text;uniqueIndex:idx_agent_providers_actor_ptid_provider"`
	DisplayName   string          `gorm:"type:varchar(256)"`
	BaseURL       string          `gorm:"type:text"`
	KeyVaults     string          `gorm:"type:text"`
	Config        json.RawMessage `gorm:"type:jsonb"`
	HiddenModels  string          `gorm:"type:text"`
	SourceType    string          `gorm:"type:varchar(20)"`
	CheckModel    string          `gorm:"type:text"`
	RuntimeKind   string          `gorm:"type:varchar(20)"`
	CliCommand    string          `gorm:"type:text"`
	ModelsCommand string          `gorm:"type:text"`
	Protocol      string          `gorm:"type:varchar(40)"`
	Enabled       bool            `gorm:"not null;default:true"`
	Version       int64           `gorm:"not null;default:1"`
	CreatedAt     time.Time       `gorm:"not null;autoCreateTime"`
	UpdatedAt     time.Time       `gorm:"not null;autoUpdateTime"`
}

// TableName sets the table name.
func (AgentProvider) TableName() string { return "agent_providers" }
