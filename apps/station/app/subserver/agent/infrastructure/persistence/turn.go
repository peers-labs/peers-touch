package persistence

import "time"

// AgentTurn maps to the agent_turns table.
type AgentTurn struct {
	ID                        string     `gorm:"primaryKey;type:varchar(36)"`
	ConversationID            string     `gorm:"not null;type:varchar(36);index:idx_turns_conversation_id;uniqueIndex:idx_turn_idempotency,priority:1"`
	AgentID                   string     `gorm:"not null;type:varchar(36);index:idx_turns_agent_id"`
	ClientIdempotencyKey      *string    `gorm:"type:varchar(100);uniqueIndex:idx_turn_idempotency,priority:2"`
	AdmissionPayloadHash      string     `gorm:"not null;type:varchar(64);default:''"`
	UserInput                 *string    `gorm:"type:text"`
	FinalResponse             *string    `gorm:"type:text"`
	ProviderAttemptCount      uint32     `gorm:"not null;default:0"`
	ProviderContinuationCount uint32     `gorm:"not null;default:0"`
	ProviderRetryCount        uint32     `gorm:"not null;default:0"`
	ProviderAuxiliaryCount    uint32     `gorm:"not null;default:0"`
	ToolIterations            int        `gorm:"not null;default:0"`
	Status                    string     `gorm:"not null;type:varchar(20);default:'running'"`
	TerminalReason            string     `gorm:"not null;type:varchar(100);default:''"`
	StartedAt                 time.Time  `gorm:"not null;autoCreateTime"`
	EndedAt                   *time.Time `gorm:"type:timestamp"`
	// TW-D2: NULL while the Turn has not issued an irreversible provider or
	// tool request. Admissions in this window may amend the Turn; after the
	// fence every subsequent admission queues FIFO as a new Turn.
	DispatchFencedAt *time.Time `gorm:"type:timestamp;index:idx_turns_dispatch_fence"`

	// Relations
	Conversation Conversation `gorm:"foreignKey:ConversationID;references:ID"`
	Trace        *TurnTrace   `gorm:"foreignKey:TurnID;references:ID"`
}

// TableName sets the table name.
func (AgentTurn) TableName() string { return "agent_turns" }
