package persistence

import "time"

// Bot inbound turn projection statuses. The lifecycle is queued → admitted →
// processing → delivered, with explicit failed/cancelled terminals. Replays
// and restarts resume any non-terminal row.
const (
	BotInboundStatusQueued     = "queued"
	BotInboundStatusAdmitted   = "admitted"
	BotInboundStatusProcessing = "processing"
	BotInboundStatusDelivered  = "delivered"
	BotInboundStatusNoReply    = "no_reply"
	BotInboundStatusFailed     = "failed"
	BotInboundStatusCancelled  = "cancelled"
)

// BotInboundTurn projects one accepted external publishing message into a
// bound Station Agent turn. The row is keyed by the inbound message identity,
// which makes projection idempotent across HTTP retries and process restarts.
type BotInboundTurn struct {
	ID                   string     `gorm:"column:id;primaryKey;size:80"`
	PublishingID         string     `gorm:"column:publishing_id;size:128;not null;index:idx_bot_turn_publishing"`
	BotPtid              string     `gorm:"column:bot_ptid;size:255;not null;index:idx_bot_turn_bot"`
	OwnerPtid            string     `gorm:"column:owner_ptid;size:255;not null;index:idx_bot_turn_owner"`
	AgentID              string     `gorm:"column:agent_id;size:255;not null"`
	DirectConversationID string     `gorm:"column:direct_conversation_id;size:128;not null"`
	AgentConversationID  string     `gorm:"column:agent_conversation_id;size:128;not null;index"`
	TurnID               string     `gorm:"column:turn_id;size:128;not null;default:'';index"`
	AdmissionKey         string     `gorm:"column:admission_key;size:160;not null"`
	UserInput            string     `gorm:"column:user_input;type:text;not null"`
	Status               string     `gorm:"column:status;size:24;not null;index"`
	Attempts             int        `gorm:"column:attempts;not null;default:0"`
	LastError            string     `gorm:"column:last_error;type:text;not null;default:''"`
	ReceivedAt           time.Time  `gorm:"column:received_at;not null;index"`
	UpdatedAt            time.Time  `gorm:"column:updated_at;not null"`
	LeaseToken           string     `gorm:"column:lease_token;size:64;not null;default:''"`
	LeaseExpiresAt       *time.Time `gorm:"column:lease_expires_at;index"`
	DeliveredAt          *time.Time `gorm:"column:delivered_at"`
}

func (BotInboundTurn) TableName() string { return "agent_bot_inbound_turn" }
