package persistence

import "time"

// Credential maps to the agent_credential_pool table.
type Credential struct {
	ID            string     `gorm:"primaryKey;type:varchar(36)"`
	Provider      string     `gorm:"not null;type:varchar(64);index:idx_credentials_provider"`
	Label         *string    `gorm:"type:varchar(255)"`
	AuthType      string     `gorm:"not null;type:varchar(20)"`
	Priority      int        `gorm:"not null;default:0"`
	Source        string     `gorm:"not null;type:varchar(20)"`
	Status        string     `gorm:"not null;type:varchar(20);default:'active'"`
	RequestCount  int        `gorm:"not null;default:0"`
	ExhaustedAt   *time.Time `gorm:"type:timestamp"`
	CooldownUntil *time.Time `gorm:"type:timestamp"`
	CreatedAt     time.Time  `gorm:"not null;default:now()"`
	UpdatedAt     time.Time  `gorm:"not null;default:now()"`
}

// TableName sets the table name.
func (Credential) TableName() string { return "agent_credential_pool" }
