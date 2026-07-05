package persistence

import "time"

// AgentTurn maps to the agent_turns table.
type AgentTurn struct {
	ID             string     `gorm:"primaryKey;type:varchar(36)"`
	ConversationID string     `gorm:"not null;type:varchar(36);index:idx_turns_conversation_id"`
	AgentID        string     `gorm:"not null;type:varchar(36);index:idx_turns_agent_id"`
	UserInput      *string    `gorm:"type:text"`
	FinalResponse  *string    `gorm:"type:text"`
	ToolIterations int        `gorm:"not null;default:0"`
	Status         string     `gorm:"not null;type:varchar(20);default:'running'"`
	StartedAt      time.Time  `gorm:"not null;autoCreateTime"`
	EndedAt        *time.Time `gorm:"type:timestamp"`

	// Relations
	Conversation Conversation `gorm:"foreignKey:ConversationID;references:ID"`
	Trace        *TurnTrace   `gorm:"foreignKey:TurnID;references:ID"`
}

// TableName sets the table name.
func (AgentTurn) TableName() string { return "agent_turns" }
