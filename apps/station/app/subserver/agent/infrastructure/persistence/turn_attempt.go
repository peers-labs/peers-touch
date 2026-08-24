package persistence

import (
	"encoding/json"
	"time"
)

// TurnAttempt is one execution attempt under an immutable AgentTurn.
type TurnAttempt struct {
	ID                  string `gorm:"primaryKey;type:varchar(36)"`
	TurnID              string `gorm:"not null;type:varchar(36);uniqueIndex:idx_turn_attempt_index,priority:1;index"`
	AttemptIndex        uint32 `gorm:"not null;uniqueIndex:idx_turn_attempt_index,priority:2"`
	Status              string `gorm:"not null;type:varchar(20)"`
	ErrorCode           string `gorm:"not null;type:varchar(100);default:''"`
	ProviderRequestRef  string `gorm:"not null;type:text;default:''"`
	ReadinessSnapshotID string `gorm:"not null;type:varchar(100);default:''"`
	// ContextLedger is the JSON-serialized typed ContextLedger for this attempt.
	// It contains ordered segments with source refs, content hashes, token
	// estimates, and inclusion/truncation decisions (MCA-D04).
	ContextLedger string          `gorm:"not null;type:mediumtext;default:''"`
	UsageJSON     json.RawMessage `gorm:"type:jsonb;column:usage_json"`
	StartedAt     time.Time       `gorm:"not null"`
	EndedAt       *time.Time      `gorm:"type:timestamp"`
}

func (TurnAttempt) TableName() string { return "agent_turn_attempts" }
