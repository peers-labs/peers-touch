package persistence

import "time"

type TurnQueueEntry struct {
	ID                   string     `gorm:"primaryKey;type:varchar(36)"`
	ConversationID       string     `gorm:"not null;type:varchar(36);index:idx_turn_queue_pending,priority:1;uniqueIndex:idx_turn_queue_idempotency,priority:1"`
	AgentID              string     `gorm:"not null;type:varchar(36);index"`
	Ptid                 string     `gorm:"not null;type:text;index"`
	ClientIdempotencyKey string     `gorm:"not null;type:varchar(100);uniqueIndex:idx_turn_queue_idempotency,priority:2"`
	AdmissionPayloadHash string     `gorm:"not null;type:varchar(64)"`
	RequestPayload       []byte     `gorm:"not null;type:bytea"`
	QueueSequence        uint64     `gorm:"not null;index:idx_turn_queue_pending,priority:3"`
	Status               string     `gorm:"not null;type:varchar(20);index:idx_turn_queue_pending,priority:2"`
	AdmittedTurnID       string     `gorm:"not null;type:varchar(36);default:''"`
	CancelIdempotencyKey string     `gorm:"not null;type:varchar(100);default:''"`
	CreatedAt            time.Time  `gorm:"not null"`
	UpdatedAt            time.Time  `gorm:"not null"`
	CancelledAt          *time.Time `gorm:"type:timestamp"`
}

func (TurnQueueEntry) TableName() string { return "agent_turn_queue" }
