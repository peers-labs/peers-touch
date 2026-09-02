package persistence

import "time"

// RevisionCommand stores one actor-scoped idempotency result for MCA-D08A.
type RevisionCommand struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	Ptid           string    `gorm:"not null;type:text;uniqueIndex:idx_revision_command_key,priority:1"`
	CommandKind    string    `gorm:"not null;type:varchar(40);uniqueIndex:idx_revision_command_key,priority:2"`
	IdempotencyKey string    `gorm:"not null;type:varchar(160);uniqueIndex:idx_revision_command_key,priority:3"`
	PayloadHash    string    `gorm:"not null;type:varchar(64)"`
	ResponseJSON   string    `gorm:"not null;type:text"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime"`
}

func (RevisionCommand) TableName() string { return "agent_revision_commands" }
