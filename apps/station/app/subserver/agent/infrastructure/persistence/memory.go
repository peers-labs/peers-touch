// Changelog:
// 2026-04-11 — Added IsFrozen field: when true, the memory entry cannot be
//   modified or deleted by the LLM — only admin actions can unfreeze it.
//   This protects critical memories from accidental overwrite during
//   self-improvement cycles.

package persistence

import "time"

// Memory maps to the agent_memories table.
type Memory struct {
	ID             string  `gorm:"primaryKey;type:varchar(36)"`
	AgentID        string  `gorm:"not null;type:varchar(36);index:idx_memories_agent_id"`
	Target         string  `gorm:"not null;type:varchar(20);check:target in ('memory','user');index:idx_memories_agent_target,priority:2"`
	Layer          string  `gorm:"not null;type:varchar(30);default:'preference';index:idx_memories_layer"`
	SessionID      string  `gorm:"not null;type:varchar(64);default:'';index:idx_memories_session"`
	Content        string  `gorm:"not null;type:text"`
	Summary        string  `gorm:"not null;type:text;default:''"`
	Relevance      float64 `gorm:"not null;default:0"`
	SourceTurnID   *string `gorm:"type:varchar(36)"`
	Source         string  `gorm:"not null;type:varchar(20);default:'turn'"`
	SourceReviewID *string `gorm:"type:varchar(36)"`
	IsFrozen       bool    `gorm:"not null;default:false"`
	TrustScore     float64 `gorm:"not null;default:0.5"`
	RetrievalCount int     `gorm:"not null;default:0"`
	LastAccessedAt *time.Time
	HelpfulCount   int       `gorm:"not null;default:0"`
	HarmfulCount   int       `gorm:"not null;default:0"`
	CreatedAt      time.Time `gorm:"not null;default:now()"`
	UpdatedAt      time.Time `gorm:"not null;default:now()"`
}

// TableName sets the table name.
func (Memory) TableName() string { return "agent_memories" }
