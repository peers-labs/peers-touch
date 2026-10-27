package persistence

import "time"

// BotAgentBindingModel is the bot_agent_binding table. One row per bot. The
// binding is the single switch for automatic replies; absence means the bot
// only receives inbound messages. Version is an optimistic concurrency token
// owned by the application layer.
type BotAgentBindingModel struct {
	ID        uint64    `gorm:"column:id;primaryKey;autoIncrement:true"`
	BotPtid   string    `gorm:"column:bot_ptid;size:255;uniqueIndex;not null"`
	OwnerPtid string    `gorm:"column:owner_ptid;size:255;not null;index:idx_bot_binding_owner"`
	AgentID   string    `gorm:"column:agent_id;size:255;not null"`
	Enabled   bool      `gorm:"column:enabled;not null;index"`
	Version   int64     `gorm:"column:version;not null"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (BotAgentBindingModel) TableName() string { return "bot_agent_binding" }
