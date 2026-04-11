// Changelog:
// 2026-04-11 — Added IsFrozen field: when true, the memory entry cannot be
//   modified or deleted by the LLM — only admin actions can unfreeze it.
//   This protects critical memories from accidental overwrite during
//   self-improvement cycles.

package persistence

import "time"

// Memory maps to the agent_memories table.
type Memory struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID        string    `gorm:"not null;type:varchar(36);index:idx_memories_agent_id;uniqueIndex:idx_memories_agent_target,priority:1"`
	Target         string    `gorm:"not null;type:varchar(20);check:target in ('memory','user');uniqueIndex:idx_memories_agent_target,priority:2"`
	Content        string    `gorm:"not null;type:text"`
	SourceTurnID   *string   `gorm:"type:varchar(36)"`
	Source         string    `gorm:"not null;type:varchar(20);default:'turn'"`
	SourceReviewID *string   `gorm:"type:varchar(36)"`
	IsFrozen       bool      `gorm:"not null;default:false"`
	TrustScore     float64   `gorm:"not null;default:0.5"`
	RetrievalCount int       `gorm:"not null;default:0"`
	HelpfulCount   int       `gorm:"not null;default:0"`
	HarmfulCount   int       `gorm:"not null;default:0"`
	CreatedAt      time.Time `gorm:"not null;default:now()"`
	UpdatedAt      time.Time `gorm:"not null;default:now()"`
}

// TableName sets the table name.
func (Memory) TableName() string { return "agent_memories" }
