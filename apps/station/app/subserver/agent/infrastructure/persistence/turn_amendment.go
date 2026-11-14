package persistence

import "time"

// AgentTurnAmendment stores one TW-D2 amendment: an admitted ExecuteTurn
// request merged into a still-pre-dispatch Turn. The full request payload is
// retained so the executor assembles one deterministic merged input and so
// admission replay resolves the client idempotency key to AMENDED.
type AgentTurnAmendment struct {
	ID                   uint64    `gorm:"primaryKey;autoIncrement"`
	TurnID               string    `gorm:"not null;type:varchar(36);uniqueIndex:idx_turn_amendment_turn_seq,priority:1"`
	ConversationID       string    `gorm:"not null;type:varchar(36);index:idx_turn_amendment_conversation"`
	AgentID              string    `gorm:"not null;type:varchar(36);index"`
	Ptid                 string    `gorm:"not null;type:text;index"`
	Seq                  uint32    `gorm:"not null;uniqueIndex:idx_turn_amendment_turn_seq,priority:2"`
	ClientIdempotencyKey string    `gorm:"not null;type:varchar(100);uniqueIndex:idx_turn_amendment_idempotency"`
	AdmissionPayloadHash string    `gorm:"not null;type:varchar(64)"`
	RequestPayload       []byte    `gorm:"not null;type:bytea"`
	CreatedAt            time.Time `gorm:"not null"`
}

func (AgentTurnAmendment) TableName() string { return "agent_turn_amendments" }
