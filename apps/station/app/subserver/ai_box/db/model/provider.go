package model

import (
	"encoding/json"
	"time"
)

// Provider 提供商表
type Provider struct {
	ID          string          `gorm:"primaryKey;type:varchar(64)"`
	Name        string          `gorm:"type:text"`
	PeersUserID string          `gorm:"primaryKey;type:text;index"`
	Sort        int             `gorm:"type:integer"`
	Enabled     bool            `gorm:"type:boolean"`
	CheckModel  string          `gorm:"type:text"`
	Logo        string          `gorm:"type:text"`
	Description string          `gorm:"type:text"`
	KeyVaults   string          `gorm:"type:text"`
	SourceType  string          `gorm:"type:varchar(20)"`
	Settings    json.RawMessage `gorm:"type:jsonb"`
	AccessedAt  time.Time       `gorm:"not null;default:now()"`
	CreatedAt   time.Time       `gorm:"not null;default:now()"`
	UpdatedAt   time.Time       `gorm:"not null;default:now()"`
	Config      json.RawMessage `gorm:"type:jsonb"`

	// 关联关系
	User     User      `gorm:"foreignKey:PeersUserID;references:PeersUserID"`
	Sessions []Session `gorm:"foreignKey:ProviderID;references:ID"`
}

// TableName 设置表名
func (Provider) TableName() string {
	return "ai_box.providers"
}
