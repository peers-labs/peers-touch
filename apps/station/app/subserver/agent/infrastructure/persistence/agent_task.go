package persistence

import "time"

// AgentTask is a user-created todo-style task card for a single agent, with a
// manual lifecycle (pending → running/paused → completed/cancelled/failed).
// Distinct from CollaborationTask (multi-agent orchestration) and TaskRun
// (chat conversation root runtime). Subtasks are stored as a JSON array.
type AgentTask struct {
	ID           string     `gorm:"primaryKey;type:varchar(36)"`
	Title        string     `gorm:"not null;type:text"`
	Description  string     `gorm:"type:text"`
	AgentID      string     `gorm:"not null;type:varchar(36);index:idx_agent_tasks_agent_id"`
	Status       string     `gorm:"not null;type:varchar(20);default:'pending';index:idx_agent_tasks_status"`
	Priority     string     `gorm:"not null;type:varchar(10);default:'medium'"`
	Progress     int        `gorm:"not null;default:0"`
	SubtasksJSON string     `gorm:"type:text"` // JSON array of {id,title,status,completed_at}
	TopicKey     string     `gorm:"type:varchar(64)"`
	Result       string     `gorm:"type:text"`
	Error        string     `gorm:"type:text"`
	OwnerActorID string     `gorm:"not null;type:text;index:idx_agent_tasks_owner"`
	CompletedAt  *time.Time `gorm:"type:timestamptz"`
	CreatedAt    time.Time  `gorm:"not null;autoCreateTime;index:idx_agent_tasks_created_at"`
	UpdatedAt    time.Time  `gorm:"not null;autoUpdateTime"`
}

// TableName sets the table name.
func (AgentTask) TableName() string { return "agent_tasks" }
