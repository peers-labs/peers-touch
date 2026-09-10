package persistence

import "time"

// Credential maps to the agent_credential_pool table.
type Credential struct {
	ID            string     `gorm:"primaryKey;type:varchar(36)"`
	ActorPTID     string     `gorm:"column:actor_ptid;not null;type:text;default:'';uniqueIndex:idx_credentials_actor_ptid_provider"`
	Provider      string     `gorm:"not null;type:varchar(64);uniqueIndex:idx_credentials_actor_ptid_provider"`
	Label         *string    `gorm:"type:varchar(255)"`
	AuthType      string     `gorm:"not null;type:varchar(20)"`
	Priority      int        `gorm:"not null;default:0"`
	Source        string     `gorm:"not null;type:varchar(20)"`
	Status        string     `gorm:"not null;type:varchar(20);default:'active'"`
	RequestCount  int        `gorm:"not null;default:0"`
	ExhaustedAt   *time.Time `gorm:"type:timestamp"`
	CooldownUntil *time.Time `gorm:"type:timestamp"`
	Version       int64      `gorm:"not null;default:1"`
	CreatedAt     time.Time  `gorm:"not null;autoCreateTime"`
	UpdatedAt     time.Time  `gorm:"not null;autoUpdateTime"`
}

// TableName sets the table name.
func (Credential) TableName() string { return "agent_credential_pool" }
