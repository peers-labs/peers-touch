package persistence

import (
	"time"

	"gorm.io/gorm"
)

type AgentOfflineOp struct {
	ID              string    `gorm:"primaryKey;type:varchar(36)"`
	AgentID         string    `gorm:"not null;type:varchar(36);index:idx_offline_agent_device"`
	DeviceID        string    `gorm:"not null;type:varchar(64);index:idx_offline_agent_device"`
	OpType          string    `gorm:"not null;type:varchar(50)"`
	Status          string    `gorm:"not null;type:varchar(20);default:'pending';index:idx_offline_status"`
	Payload         string    `gorm:"not null;type:text"`
	ClientRequestID string    `gorm:"type:varchar(64);index:idx_offline_client_req"`
	RetryCount      int32     `gorm:"not null;default:0"`
	ErrorMessage    string    `gorm:"type:text"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ProcessedAt     *time.Time
	DeletedAt       gorm.DeletedAt `gorm:"index"`
}

func (AgentOfflineOp) TableName() string {
	return "agent_offline_ops"
}
