package persistence

import "time"

type CLIProfileDefault struct {
	Scope                   string `gorm:"primaryKey;type:varchar(16)"`
	ActorPTID               string `gorm:"primaryKey;column:actor_ptid;type:text"`
	CLIAdapterID            string `gorm:"primaryKey;column:cli_adapter_id;type:varchar(128)"`
	DefaultProviderRecordID string `gorm:"type:varchar(36);not null;default:''"`
	Revision                int64  `gorm:"not null;default:1"`
	UpdatedAt               time.Time
}

func (CLIProfileDefault) TableName() string { return "agent_cli_profile_defaults" }
