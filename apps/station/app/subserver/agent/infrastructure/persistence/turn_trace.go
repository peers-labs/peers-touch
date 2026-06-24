package persistence

import "encoding/json"

// TurnTrace maps to the agent_turn_traces table.
type TurnTrace struct {
	ID                   string          `gorm:"primaryKey;type:varchar(36)"`
	TurnID               string          `gorm:"not null;type:varchar(36);uniqueIndex:idx_turn_traces_turn_id"`
	SystemPromptHash     *string         `gorm:"type:varchar(64)"`
	MemorySnapshotHash   *string         `gorm:"type:varchar(64)"`
	SkillIndexHash       *string         `gorm:"type:varchar(64)"`
	SkillsLoaded         json.RawMessage `gorm:"type:jsonb;column:skills_loaded"`
	ToolCalls            json.RawMessage `gorm:"type:jsonb;column:tool_calls"`
	ProviderCalls        json.RawMessage `gorm:"type:jsonb;column:provider_calls"`
	ReviewTriggered      bool            `gorm:"not null;default:false"`
	ErrorsClassified     json.RawMessage `gorm:"type:jsonb;column:errors_classified"`
	CompressionTriggered bool            `gorm:"not null;default:false"`
	CompressionBefore    *int            `gorm:"type:integer"`
	CompressionAfter     *int            `gorm:"type:integer"`
	DelegationResults    json.RawMessage `gorm:"type:jsonb;column:delegation_results"`
	KnowledgeChunks      json.RawMessage `gorm:"type:jsonb;column:knowledge_chunks"`

	// Relations
	Turn AgentTurn `gorm:"foreignKey:TurnID;references:ID"`
}

// TableName sets the table name.
func (TurnTrace) TableName() string { return "agent_turn_traces" }
