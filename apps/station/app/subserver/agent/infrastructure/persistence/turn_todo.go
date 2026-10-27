package persistence

import "time"

// AgentTurnTodo stores the Agent's task checklist for one conversation.
// The list is Station-owned task state for the todo_write/todo_update
// builtin tools, so the model keeps the same checklist across turns within
// a working session while every item stays attributable to its origin turn.
// It is not a user product surface.
type AgentTurnTodo struct {
	ID             string    `gorm:"primaryKey;type:varchar(64)"`
	TurnID         string    `gorm:"primaryKey;not null;type:varchar(36);index:idx_turn_todos_turn"`
	ActorPTID      string    `gorm:"not null;type:varchar(128);index:idx_turn_todos_actor"`
	ConversationID string    `gorm:"not null;type:varchar(36);index:idx_turn_todos_conversation;uniqueIndex:idx_todo_conversation_order,priority:1"`
	AgentID        string    `gorm:"not null;type:varchar(36);index:idx_turn_todos_agent"`
	Position       int       `gorm:"not null;uniqueIndex:idx_todo_conversation_order,priority:2"`
	Content        string    `gorm:"not null;type:text"`
	Status         string    `gorm:"not null;type:varchar(20);default:'pending'"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime"`
}

// TableName sets the table name.
func (AgentTurnTodo) TableName() string { return "agent_turn_todos" }
