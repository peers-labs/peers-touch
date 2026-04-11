// Changelog:
// 2026-04-11 — Created MemorySnapshot persistence model: records point-in-time
//   snapshots of all memories for an agent, enabling rollback when the agent
//   exhibits regression (the "dumbed-down agent" recovery path).
//   Snapshots are taken automatically before each memory mutation (add/replace/
//   remove), before compression flush, and on manual/rollback triggers.

package persistence

import "time"

// MemorySnapshot records a point-in-time snapshot of all memories for an agent.
// Created before each memory mutation (add/replace/remove) and before compression flush.
type MemorySnapshot struct {
	ID        string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID   string    `gorm:"not null;type:varchar(36);index:idx_memory_snapshots_agent"`
	TurnID    *string   `gorm:"type:varchar(36)"`
	Trigger   string    `gorm:"not null;type:varchar(30)"` // mutation, flush, manual, rollback
	Content   string    `gorm:"not null;type:text"`        // JSON array of all memories at this point
	CreatedAt time.Time `gorm:"not null;default:now();index:idx_memory_snapshots_created"`
}

// TableName sets the table name.
func (MemorySnapshot) TableName() string { return "agent_memory_rollback_snapshots" }
