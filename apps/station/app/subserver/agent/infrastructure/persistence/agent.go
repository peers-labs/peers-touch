package persistence

import "time"

type Agent struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	Name           string    `gorm:"not null;type:text"`
	Title          string    `gorm:"type:text"`
	Description    string    `gorm:"type:text"`
	ProviderID     string    `gorm:"type:text"`
	ModelName      string    `gorm:"type:text"`
	Effort         string    `gorm:"type:varchar(20)"`
	Visibility     string    `gorm:"not null;type:varchar(20);default:'private';index:idx_agents_visibility"`
	OwnerActorPTID string    `gorm:"column:owner_actor_ptid;not null;type:text;index:idx_agents_owner_actor_ptid"`
	ConfigJSON     string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime"`
}

func (Agent) TableName() string { return "agents" }
