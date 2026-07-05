package persistence

import "time"

// MemoryEvent records memory lifecycle and retrieval events for debugging,
// tuning, and UI timelines.
type MemoryEvent struct {
	ID        string    `gorm:"primaryKey;type:varchar(36)"`
	Type      string    `gorm:"not null;type:varchar(40);index:idx_memory_events_type"`
	MemoryID  string    `gorm:"not null;type:varchar(36);default:'';index:idx_memory_events_memory"`
	SessionID string    `gorm:"not null;type:varchar(64);default:'';index:idx_memory_events_session"`
	AgentID   string    `gorm:"not null;type:varchar(36);default:'';index:idx_memory_events_agent"`
	Layer     string    `gorm:"not null;type:varchar(30);default:'';index:idx_memory_events_layer"`
	Detail    string    `gorm:"not null;type:text;default:''"`
	LatencyMs int64     `gorm:"not null;default:0"`
	CreatedAt time.Time `gorm:"not null;autoCreateTime;index:idx_memory_events_created"`
}

func (MemoryEvent) TableName() string { return "agent_memory_events" }
